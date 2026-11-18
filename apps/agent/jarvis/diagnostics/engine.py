"""Diagnostic sessions (spec §8.1): plan collectors for a profile, collect
read-only evidence with timeouts, evaluate rules, persist evidence and findings.
"""

from __future__ import annotations

import threading
import time
from datetime import UTC, datetime
from typing import Any

from ..collectors import network, system, windows
from ..collectors.sampler import sampler
from ..storage import db
from .evidence import Evidence, section
from .rules import NOT_YET, RULES, Context

PROFILES: dict[str, dict[str, Any]] = {
    "quick_health": {
        "label": "Quick health",
        "probe": ("events", "devices", "services", "security", "netconfig"),
        "event_hours": 24,
        "ping_count": 10,
        "dns": True,
        "https": True,
    },
    "performance": {"label": "Performance", "probe": ("events", "disks", "startup", "services"), "event_hours": 24, "ping_count": 0},
    "network": {"label": "Network", "probe": ("adapters", "netconfig"), "event_hours": 24, "ping_count": 60, "dns": True, "https": True},
    "stability": {"label": "Stability", "probe": ("events", "devices"), "event_hours": 24 * 7, "ping_count": 0},
    "hardware": {"label": "Hardware", "probe": ("disks", "battery", "bluetooth", "audio", "devices", "services"), "event_hours": 24, "ping_count": 0},
    "full": {"label": "Full system", "probe": windows.ALL_SECTIONS, "event_hours": 24, "ping_count": 30, "dns": True, "https": True},
}

PROBE_TYPES = {
    "events": "windows.events",
    "devices": "windows.devices",
    "disks": "windows.disks",
    "adapters": "windows.adapters",
    "netconfig": "net.config",
    "security": "windows.security",
    "services": "windows.services",
    "battery": "windows.battery",
    "startup": "windows.startup",
    "bluetooth": "windows.bluetooth",
    "audio": "windows.audio",
}

_running: dict[str, threading.Thread] = {}
_lock = threading.Lock()


def start_session(profile: str, symptom: str | None = None, reason: str = "user_requested") -> str:
    if profile not in PROFILES:
        raise ValueError(f"Unknown profile {profile}")
    session_id = db.new_id("dgs")
    with db.session() as s:
        s.add(db.DiagnosticSession(id=session_id, profile=profile, status="queued", reason=reason, progress=[], summary={}))
    db.audit("scan.started", f"{PROFILES[profile]['label']} scan started", {"session_id": session_id, "profile": profile})
    t = threading.Thread(target=_run, args=(session_id, profile, symptom), name=f"scan-{session_id}", daemon=True)
    with _lock:
        _running[session_id] = t
    t.start()
    return session_id


def _progress(session_id: str, collector_id: str, status: str, message: str = "") -> None:
    with db.session() as s:
        row = s.get(db.DiagnosticSession, session_id)
        if row:
            steps = [p for p in (row.progress or []) if p["collector_id"] != collector_id]
            steps.append({"collector_id": collector_id, "status": status, "message": message})
            row.progress = steps
            if row.status == "queued":
                row.status = "running"


def collect(profile: str, session_id: str | None = None) -> dict[str, Evidence]:
    """Collect the evidence a profile needs. Each collector fails on its own."""
    spec = PROFILES[profile]
    ev: dict[str, Evidence] = {}

    def step(cid: str, fn) -> None:  # noqa: ANN001
        if session_id:
            _progress(session_id, cid, "running")
        try:
            for item in fn():
                ev[item.evidence_type] = item
            if session_id:
                _progress(session_id, cid, "done")
        except Exception as exc:  # collectors must never take the scan down
            if session_id:
                _progress(session_id, cid, "error", type(exc).__name__)

    # The real gateway address is needed for the ping, but stored evidence is redacted.
    # It is kept only in memory for this scan.
    private: dict[str, Any] = {}
    step("system.psutil", lambda: _system_evidence())
    step("sampler.windows", lambda: _window_evidence())
    if spec.get("probe"):
        step("windows.probe", lambda: _probe_evidence(spec["probe"], spec.get("event_hours", 24), private))
    if spec.get("ping_count") or spec.get("dns") or spec.get("https"):
        step("network.probes", lambda: _network_evidence(private.get("gateways", []), spec))
    return ev


def _system_evidence() -> list[Evidence]:
    return [
        Evidence("os.psutil.v1", "os.info", "platform/psutil", system.os_info()),
        Evidence("cpu.psutil.v1", "cpu.snapshot", "psutil.cpu_percent", system.cpu(0.5), units={"percent": "percent"}),
        Evidence("memory.psutil.v1", "memory.snapshot", "psutil.virtual_memory", system.memory(), units={"available_bytes": "byte"}),
        Evidence("volume.psutil.v1", "volume.list", "psutil.disk_usage", system.volumes()),
        Evidence("process.psutil.v1", "process.top", "psutil.process_iter", sampler.latest_processes(10) or system.top_processes(10, 1.0)),
    ]


def _window_evidence() -> list[Evidence]:
    now = time.time()
    samples = sampler.recent(600)
    limitation = [] if len(samples) >= 12 else ["JARVIS has been running for less than two minutes, so trends are short."]
    quality = "valid" if samples else "unsupported"
    cpu = [{"age_s": round(now - s.at.timestamp()), "cpu": s.cpu} for s in samples]
    mem = [{"age_s": round(now - s.at.timestamp()), "available_percent": s.mem_available_percent} for s in samples]
    disk = [{"age_s": round(now - s.at.timestamp()), "busy": s.disk_busy} for s in samples]
    out = [
        Evidence("cpu.sampler.v1", "cpu.window", "jarvis sampler (10 s)", cpu, quality=quality, limitations=limitation),
        Evidence("memory.sampler.v1", "memory.window", "jarvis sampler (10 s)", mem, quality=quality, limitations=limitation),
        Evidence("disk.sampler.v1", "disk.window", "jarvis sampler (10 s)", disk, quality=quality, limitations=limitation),
    ]
    history = sampler.process_history()
    if len(history) >= 2:
        first, last = history[0], history[-1]
        minutes = (last.at - first.at).total_seconds() / 60
        growth = []
        for pid, (name, _cpu, rss_last, created) in last.rows.items():
            start = first.rows.get(pid)
            if not start or start[3] != created or start[2] <= 0:
                continue
            tail = [h.rows[pid][2] for h in history[-3:] if pid in h.rows]
            growth.append(
                {
                    "name": name,
                    "first_bytes": start[2],
                    "last_bytes": rss_last,
                    "growth_bytes": rss_last - start[2],
                    "growth_ratio": round(rss_last / start[2], 2),
                    "still_growing": len(tail) >= 3 and tail[0] <= tail[1] <= tail[2],
                }
            )
        growth.sort(key=lambda g: g["growth_bytes"], reverse=True)
        out.append(Evidence("process.sampler.v1", "process.history", "jarvis sampler (30 s)", {"minutes": round(minutes, 1), "snapshots": len(history), "growth": growth[:10]}))
    return out


def _probe_evidence(sections: tuple[str, ...], event_hours: int, private: dict[str, Any]) -> list[Evidence]:
    raw = windows.run_probe(tuple(sections), event_hours=event_hours)
    netconfig = raw.get("netconfig") or {}
    private["gateways"] = [g for row in (netconfig.get("data") or []) for g in (row.get("gateways") or []) if g and g != "0.0.0.0"]
    return [section(f"{name}.powershell.v1", PROBE_TYPES[name], f"PowerShell ({name})", raw.get(name)) for name in sections]


def _network_evidence(real_gateways: list[str], spec: dict[str, Any]) -> list[Evidence]:
    out: list[Evidence] = []
    if spec.get("ping_count") and not real_gateways and "netconfig" not in spec.get("probe", ()):
        raw = windows.run_probe(("netconfig",)).get("netconfig", {})
        real_gateways = [g for row in (raw.get("data") or []) for g in (row.get("gateways") or []) if g and g != "0.0.0.0"]
    if spec.get("ping_count") and real_gateways:
        result = network.ping(real_gateways[0], count=spec["ping_count"])
        out.append(Evidence("net.ping.v1", "net.gateway_ping", "ping.exe to default gateway", result, units={"loss_percent": "percent", "avg_ms": "ms"}))
    elif spec.get("ping_count"):
        out.append(Evidence("net.ping.v1", "net.gateway_ping", "ping.exe", None, quality="unsupported", limitations=["No default gateway: the PC is not connected to a network."]))
    if spec.get("dns"):
        out.append(Evidence("net.dns.v1", "net.dns", "getaddrinfo", network.dns_checks()))
    if spec.get("https"):
        out.append(Evidence("net.https.v1", "net.https", "HTTPS GET", network.https_checks()))
    return out


def evaluate(evidence: dict[str, Evidence], symptom: str | None = None) -> list[tuple[Any, Any]]:
    ctx = Context(evidence=evidence, symptom=symptom)
    results = []
    for r in RULES:
        if not all(n in evidence for n in r.needs[:1]):
            continue  # the rule's primary input was not collected in this profile
        try:
            res = r.fn(ctx)
        except Exception as exc:  # a broken rule is reported, never fatal
            db.audit("rule.error", f"{r.id} failed: {type(exc).__name__}")
            continue
        if res:
            results.append((r, res))
    return results


def _run(session_id: str, profile: str, symptom: str | None) -> None:
    started = time.monotonic()
    try:
        evidence = collect(profile, session_id)
        _progress(session_id, "rules", "running")
        results = evaluate(evidence, symptom)
        severities = ["critical", "high", "medium", "low", "info"]
        with db.session() as s:
            row = s.get(db.DiagnosticSession, session_id)
            for ev in evidence.values():
                s.add(
                    db.EvidenceItem(
                        id=ev.id, session_id=session_id, collector_id=ev.collector_id, evidence_type=ev.evidence_type, source=ev.source,
                        observed_at=ev.observed_at, quality=ev.quality, data={"value": ev.data}, units=ev.units, limitations=ev.limitations,
                    )
                )
            for r, res in results:
                s.add(
                    db.Finding(
                        id=db.new_id("fnd"), session_id=session_id, rule_id=r.id, rule_version=r.version, category=r.category,
                        title=res.title, statement=res.statement, severity=res.severity, confidence=res.confidence, facts=res.facts,
                        likely_causes=res.causes, next_step=res.next_step, limitations=res.limitations, evidence_ids=[e.id for e in res.evidence],
                        suggested_actions=res.actions,
                    )
                )
            counts = {sev: sum(1 for _, res in results if res.severity == sev) for sev in severities}
            unavailable = [{"type": k, "reason": "; ".join(e.limitations) or e.quality} for k, e in evidence.items() if not e.usable]
            evaluated = [r.id for r in RULES if r.needs[0] in evidence]
            if row:
                row.status = "completed"
                row.finished_at = datetime.now(UTC)
                row.summary = {
                    "findings": len(results),
                    "by_severity": counts,
                    "rules_evaluated": evaluated,
                    "rules_not_available": NOT_YET,
                    "unavailable_evidence": unavailable,
                    "seconds": round(time.monotonic() - started, 1),
                }
        _progress(session_id, "rules", "done")
        db.audit("scan.completed", f"{PROFILES[profile]['label']} scan found {len(results)} item(s)", {"session_id": session_id})
    except Exception as exc:
        with db.session() as s:
            row = s.get(db.DiagnosticSession, session_id)
            if row:
                row.status = "failed"
                row.finished_at = datetime.now(UTC)
                row.summary = {"error": type(exc).__name__}
        db.audit("scan.failed", f"Scan failed: {type(exc).__name__}", {"session_id": session_id})
    finally:
        with _lock:
            _running.pop(session_id, None)


def is_running() -> bool:
    with _lock:
        return bool(_running)
