"""Deterministic diagnostic rules (spec §11). Versioned and explainable.

Each rule reads normalized evidence from the scan context, and either returns
nothing or one `Result` that cites the evidence it used. Severity comes from the
rule; confidence from evidence quality, sample counts and corroboration
(`confidence()`), never from a language model. Thresholds are the spec's starting
heuristics and must be calibrated on real devices.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable

from .evidence import Evidence, gb

GB = 1024**3


@dataclass
class Result:
    title: str
    statement: str
    severity: str
    confidence: float
    facts: list[dict[str, Any]]
    causes: list[dict[str, Any]] = field(default_factory=list)
    next_step: str = ""
    limitations: list[str] = field(default_factory=list)
    evidence: list[Evidence] = field(default_factory=list)
    # Registered tools the user may approve as the next step (never chosen by a model).
    actions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class Rule:
    id: str
    version: str
    category: str
    name: str
    needs: tuple[str, ...]
    fn: Callable[["Context"], Result | None]


@dataclass
class Context:
    """Evidence by type for one scan, plus what the user reported (if anything)."""

    evidence: dict[str, Evidence]
    symptom: str | None = None

    def get(self, kind: str) -> Evidence | None:
        ev = self.evidence.get(kind)
        return ev if ev and ev.usable else None


def confidence(base: float, *, samples: int = 1, needed: int = 1, corroborated: bool = False, partial: bool = False) -> float:
    """Deterministic evidence score: rule quality x sample sufficiency, nudged by corroboration."""
    score = base * min(1.0, samples / max(1, needed))
    if corroborated:
        score += (1 - score) * 0.35
    if partial:
        score *= 0.8
    return round(max(0.05, min(0.97, score)), 2)


RULES: list[Rule] = []


def rule(id: str, version: str, category: str, name: str, *needs: str):
    def wrap(fn: Callable[[Context], Result | None]):
        RULES.append(Rule(id, version, category, name, needs, fn))
        return fn

    return wrap


def _window(ctx: Context, kind: str) -> list[dict[str, Any]]:
    ev = ctx.get(kind)
    return list(ev.data or []) if ev else []


def _rows(ctx: Context, kind: str, key: str) -> list[dict[str, Any]]:
    ev = ctx.get(kind)
    if not ev or not isinstance(ev.data, dict):
        return []
    part = ev.data.get(key) or {}
    return list(part.get("rows") or []) if isinstance(part, dict) else []


# ---- CPU / memory ------------------------------------------------------------


@rule("D-CPU-01", "1.0.0", "cpu", "high_sustained_cpu", "cpu.window", "process.top")
def cpu_sustained(ctx: Context) -> Result | None:
    win = _window(ctx, "cpu.window")
    recent = [s for s in win if s["age_s"] <= 60]
    if len(recent) < 6 or min(s["cpu"] for s in recent) < 90:
        return None
    ev = ctx.evidence["cpu.window"]
    long_high = [s for s in win if s["age_s"] <= 300]
    sustained = len(long_high) >= 25 and min(s["cpu"] for s in long_high) >= 90
    procs = ctx.get("process.top")
    top = sorted((procs.data if procs else []), key=lambda r: r.get("cpu_percent", 0), reverse=True)[:3]
    facts = [ev.fact("Lowest CPU use in the last minute", f"{min(s['cpu'] for s in recent):.0f}%")]
    if procs:
        facts += [procs.fact(f"Busy process: {p['name']}", f"{p['cpu_percent']:.0f}% CPU") for p in top]
    return Result(
        title="The processor has been very busy",
        statement="CPU use has stayed at 90% or more for at least a minute" + (" and is still high five minutes on." if sustained else "."),
        severity="high" if sustained or ctx.symptom in ("slow_pc", "app_freeze") else "medium",
        confidence=confidence(0.8, samples=len(recent), needed=6, corroborated=bool(top)),
        facts=facts,
        causes=[{"name": f"{p['name']} is using a lot of CPU", "confidence": 0.6} for p in top[:2]] or [{"name": "A background task is busy", "confidence": 0.4}],
        next_step="Check whether the busy app is doing expected work (an update, a scan, a game). JARVIS never ends processes by itself.",
        evidence=[ev] + ([procs] if procs else []),
    )


@rule("D-MEM-01", "1.0.0", "memory", "sustained_memory_pressure", "memory.window", "memory.snapshot")
def memory_pressure(ctx: Context) -> Result | None:
    win = [s for s in _window(ctx, "memory.window") if s["age_s"] <= 120]
    snap = ctx.get("memory.snapshot")
    if len(win) < 6 or max(s["available_percent"] for s in win) > 10:
        return None
    ev = ctx.evidence["memory.window"]
    paging = bool(snap and snap.data.get("swap_used_percent", 0) >= 80)
    procs = ctx.get("process.top")
    top = sorted((procs.data if procs else []), key=lambda r: r.get("memory_bytes", 0), reverse=True)[:3]
    facts = [ev.fact("Most free memory in the last 2 minutes", f"{max(s['available_percent'] for s in win):.0f}%")]
    if snap:
        facts.append(snap.fact("Free memory now", gb(snap.data.get("available_bytes"))))
        facts.append(snap.fact("Page file in use", f"{snap.data.get('swap_used_percent', 0):.0f}%"))
    if procs:
        facts += [procs.fact(f"Large app: {p['name']}", gb(p["memory_bytes"])) for p in top]
    return Result(
        title="Memory is running low",
        statement="Less than 10% of memory has been free for the last two minutes, so Windows is likely moving data to disk and apps can feel slow.",
        severity="high" if paging else "medium",
        confidence=confidence(0.8, samples=len(win), needed=6, corroborated=paging),
        facts=facts,
        causes=[{"name": f"{p['name']} is using {gb(p['memory_bytes'])}", "confidence": 0.55} for p in top[:2]],
        next_step="Close apps or browser tabs you are not using. JARVIS will not close anything for you.",
        evidence=[ev] + [e for e in (snap, procs) if e],
    )


@rule("D-MEM-02", "1.0.0", "memory", "possible_process_memory_leak", "process.history")
def memory_leak(ctx: Context) -> Result | None:
    hist = ctx.get("process.history")
    if not hist or hist.data.get("minutes", 0) < 15:
        return None
    suspects = [p for p in hist.data.get("growth", []) if p["growth_bytes"] >= 300 * 1024**2 and p["growth_ratio"] >= 1.3 and p["still_growing"]]
    if not suspects:
        return None
    worst = max(suspects, key=lambda p: p["growth_bytes"])
    return Result(
        title=f"{worst['name']} keeps using more memory",
        statement=f"Over the last {hist.data['minutes']:.0f} minutes {worst['name']} grew from {gb(worst['first_bytes'])} to {gb(worst['last_bytes'])} and has not levelled off. This can be a memory leak, or normal for what it is doing.",
        severity="medium",
        confidence=confidence(0.55, samples=hist.data.get("snapshots", 0), needed=30),
        facts=[hist.fact(f"{p['name']} growth", f"{gb(p['first_bytes'])} → {gb(p['last_bytes'])}") for p in suspects[:3]],
        causes=[{"name": "Possible memory leak in the app (hypothesis)", "confidence": 0.45}, {"name": "The app is legitimately loading more data", "confidence": 0.35}],
        next_step="Watch it a little longer. If it keeps growing, restarting that app usually returns the memory; JARVIS will only suggest it.",
        limitations=["Based on the last 30 minutes of samples only."],
        evidence=[hist],
    )


# ---- Storage ---------------------------------------------------------------------


@rule("D-DISK-01", "1.0.0", "storage", "low_system_volume_space", "volume.list")
def low_space(ctx: Context) -> Result | None:
    ev = ctx.get("volume.list")
    system = next((v for v in (ev.data if ev else []) if v.get("is_system")), None)
    if not ev or not system:
        return None
    free, free_pct = system["free_bytes"], system["free_percent"]
    if not (free_pct < 10 or free < 15 * GB):
        return None
    return Result(
        title=f"Drive {system['mount'].rstrip(chr(92))} is nearly full",
        statement=f"Only {gb(free)} ({free_pct:.0f}%) is free on the Windows drive. Updates and apps need free space to work well.",
        severity="high" if free < 5 * GB else "medium",
        confidence=confidence(0.95),
        facts=[ev.fact("Free space", f"{gb(free)} of {gb(system['total_bytes'])}"), ev.fact("Free percent", f"{free_pct:.0f}%")],
        causes=[{"name": "Large files, downloads or old updates are taking space", "confidence": 0.6}],
        next_step="Use Windows Settings > System > Storage to see what is large. JARVIS never deletes files automatically.",
        evidence=[ev],
    )


@rule("D-DISK-02", "1.0.0", "storage", "disk_saturation", "disk.window")
def disk_saturation(ctx: Context) -> Result | None:
    win = [s for s in _window(ctx, "disk.window") if s["age_s"] <= 120 and s.get("busy") is not None]
    if len(win) < 12 or min(s["busy"] for s in win) < 90:
        return None
    ev = ctx.evidence["disk.window"]
    return Result(
        title="The disk has been busy all the time",
        statement="The disk was active at least 90% of the time for two minutes, so anything that reads or writes files will wait.",
        severity="medium",
        confidence=confidence(0.65, samples=len(win), needed=12, corroborated=ctx.symptom == "slow_pc"),
        facts=[ev.fact("Lowest disk activity in 2 minutes", f"{min(s['busy'] for s in win):.0f}%")],
        causes=[{"name": "A large copy, update or scan is running", "confidence": 0.5}],
        next_step="Check Task Manager's Disk column for the app doing the work.",
        limitations=["Activity is estimated from Windows disk counters; per-request latency is not measured yet."],
        evidence=[ev],
    )


@rule("D-DISK-03", "1.0.0", "storage", "drive_health_warning", "windows.disks")
def drive_health(ctx: Context) -> Result | None:
    ev = ctx.get("windows.disks")
    bad = [d for d in (ev.data if ev else []) or [] if str(d.get("health", "")).lower() not in ("healthy", "ok", "")]
    if not ev or not bad:
        return None
    storage_events = _rows(ctx, "windows.events", "storage")
    return Result(
        title="A drive reports a health problem",
        statement=f"Windows reports {bad[0].get('model', 'a drive')} as '{bad[0].get('health')}'. Back up important files soon.",
        severity="high",
        confidence=confidence(0.8, corroborated=bool(storage_events)),
        facts=[ev.fact(f"{d.get('model')}", f"health {d.get('health')}, status {d.get('operational')}") for d in bad],
        causes=[{"name": "The drive is wearing out or has media errors", "confidence": 0.6}],
        next_step="Back up your data, then run the drive maker's diagnostic tool. JARVIS does not write to the drive.",
        limitations=[] if bad[0].get("source") == "Get-PhysicalDisk" else ["Detailed SMART counters need administrator access."],
        evidence=[ev],
    )


# ---- Display / stability ------------------------------------------------------------


@rule("D-GPU-02", "1.0.0", "gpu", "display_driver_reset", "windows.events")
def display_resets(ctx: Context) -> Result | None:
    resets = _rows(ctx, "windows.events", "display")
    if not resets:
        return None
    ev = ctx.evidence["windows.events"]
    crashes = _rows(ctx, "windows.events", "app_crashes")
    sev = "high" if len(resets) >= 3 and crashes else "medium" if len(resets) >= 2 else "low"
    return Result(
        title="The display driver stopped responding and recovered",
        statement=f"Windows recorded {len(resets)} display driver reset{'s' if len(resets) > 1 else ''} in the last 7 days. Screens can freeze or flicker when this happens.",
        severity=sev,
        confidence=confidence(0.7, samples=len(resets), needed=3, corroborated=bool(crashes)),
        facts=[ev.fact("Display driver resets (7 days)", len(resets)), ev.fact("Most recent", resets[0]["time"])],
        causes=[{"name": "Graphics driver problem", "confidence": 0.45}, {"name": "GPU overheating or overload", "confidence": 0.25}],
        next_step="Note what you were doing when it happens. Updating or rolling back the graphics driver needs your approval.",
        evidence=[ev],
    )


@rule("D-EVT-01", "1.0.0", "stability", "repeated_application_crash", "windows.events")
def repeated_crash(ctx: Context) -> Result | None:
    crashes = _rows(ctx, "windows.events", "app_crashes")
    groups = Counter((c["props"][0] or "unknown app", c["props"][2] or "") for c in crashes if c.get("props"))
    repeated = [(app, module, n) for (app, module), n in groups.most_common() if n >= 3]
    if not repeated:
        return None
    ev = ctx.evidence["windows.events"]
    app, module, n = repeated[0]
    return Result(
        title=f"{app} keeps crashing",
        statement=f"{app} crashed or stopped responding {n} times in the last 24 hours" + (f", each time in {module}." if module else "."),
        severity="medium",
        confidence=confidence(0.75, samples=n, needed=3),
        facts=[ev.fact(f"{a} crashes (24 h)", f"{k}" + (f" in {m}" if m else "")) for a, m, k in repeated[:3]],
        causes=[{"name": f"A bug or bad update in {app}", "confidence": 0.5}, {"name": f"A conflict with {module}" if module else "An add-on or driver conflict", "confidence": 0.3}],
        next_step=f"Check for an update to {app}, or repair/reinstall it from Settings > Apps.",
        evidence=[ev],
    )


@rule("D-EVT-02", "1.0.0", "stability", "unexpected_shutdown", "windows.events")
def unexpected_shutdown(ctx: Context) -> Result | None:
    kp = _rows(ctx, "windows.events", "power")
    dirty = _rows(ctx, "windows.events", "dirty_shutdown")
    if not kp and not dirty:
        return None
    ev = ctx.evidence["windows.events"]
    bug = _rows(ctx, "windows.events", "bugcheck")
    whea = _rows(ctx, "windows.events", "whea")
    n = max(len(kp), len(dirty))
    return Result(
        title="The PC shut down unexpectedly",
        statement=f"Windows recorded {n} unexpected shutdown{'s' if n > 1 else ''} in the last 7 days. On its own this does not say why: it can be a power cut, a held power button, a crash or a hardware fault.",
        severity="medium" if n >= 2 or bug or whea else "info",
        confidence=confidence(0.6, corroborated=bool(bug or whea)),
        facts=[ev.fact("Kernel-Power 41 (7 days)", len(kp)), ev.fact("Event 6008 (7 days)", len(dirty)), ev.fact("Crash reports (BugCheck 1001)", len(bug)), ev.fact("Hardware errors (WHEA)", len(whea))],
        causes=[{"name": "Crash (blue screen)", "confidence": 0.5 if bug else 0.15}, {"name": "Power loss or forced power-off", "confidence": 0.4}],
        next_step="If it happens again, note what you were doing. JARVIS links shutdowns to crashes and hardware errors that happened just before.",
        evidence=[ev],
    )


@rule("D-EVT-03", "1.0.0", "hardware", "whea_error_cluster", "windows.events")
def whea_errors(ctx: Context) -> Result | None:
    whea = _rows(ctx, "windows.events", "whea")
    if not whea:
        return None
    ev = ctx.evidence["windows.events"]
    fatal = [w for w in whea if w.get("level") in (1, 2)]
    if not fatal and len(whea) < 3:
        return None
    return Result(
        title="Hardware errors were reported",
        statement=f"Windows logged {len(whea)} hardware error record{'s' if len(whea) > 1 else ''} (WHEA) in the last 7 days" + (", including uncorrected errors." if fatal else ", all corrected."),
        severity="high" if fatal else "medium",
        confidence=confidence(0.8, samples=len(whea), needed=3),
        facts=[ev.fact("WHEA records (7 days)", len(whea)), ev.fact("Uncorrected", len(fatal))],
        causes=[{"name": "CPU, memory or PCIe device fault", "confidence": 0.5}, {"name": "Unstable overclock or power", "confidence": 0.25}],
        next_step="Keep these records. If they continue, run Windows Memory Diagnostic and check with the PC maker.",
        evidence=[ev],
    )


@rule("D-UPD-01", "1.0.0", "windows_update", "update_failure_loop", "windows.events")
def update_failures(ctx: Context) -> Result | None:
    fails = _rows(ctx, "windows.events", "update_failures")
    by_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in fails:
        title = (f.get("props") or [None, None])[1] or "an update"
        by_title[title].append(f)
    looping = {t: rows for t, rows in by_title.items() if len(rows) >= 2}
    if not looping:
        return None
    ev = ctx.evidence["windows.events"]
    title, rows = max(looping.items(), key=lambda kv: len(kv[1]))
    code = _hresult(rows[0].get("props", [None])[0])
    store_app = bool(re.match(r"^[0-9A-Z]{12}-", title))
    friendly = title.split(".", 1)[-1] if store_app else title
    app_was_open = code == "0x80073D02"
    return Result(
        title=f"An update keeps failing: {friendly}",
        statement=f"Windows tried to install {friendly} {len(rows)} times in the last 14 days and it failed each time"
        + (" because the app was open." if app_was_open else f" (error {code})."),
        severity="low" if store_app or app_was_open else "medium",
        confidence=confidence(0.85, samples=len(rows), needed=2),
        facts=[ev.fact(f"{t.split('.', 1)[-1] if re.match(r'^[0-9A-Z]{12}-', t) else t}", f"{len(r)} failures") for t, r in sorted(looping.items(), key=lambda kv: -len(kv[1]))[:4]]
        + [ev.fact("Error code", code)],
        causes=[{"name": "The app was running while it updated", "confidence": 0.8}] if app_was_open else [{"name": "Windows Update servicing problem", "confidence": 0.5}],
        next_step="Close the app and check for updates in Microsoft Store." if store_app else "Open Settings > Windows Update and retry. JARVIS does not reset update components automatically.",
        evidence=[ev],
    )


def _hresult(value: Any) -> str:
    try:
        return f"0x{int(value) & 0xFFFFFFFF:08X}"
    except (TypeError, ValueError):
        return str(value or "unknown")


# ---- Network ---------------------------------------------------------------------


def _gateway(ctx: Context) -> tuple[Evidence | None, dict[str, Any] | None]:
    ev = ctx.get("net.gateway_ping")
    return ev, (ev.data if ev else None)


@rule("D-NET-02", "1.0.0", "network", "gateway_unreachable", "net.gateway_ping")
def gateway_unreachable(ctx: Context) -> Result | None:
    ev, ping = _gateway(ctx)
    if not ev or not ping or ping.get("received", 1) > 0:
        return None
    return Result(
        title="Your router is not answering",
        statement="The PC is connected to a network, but the router (default gateway) did not answer any of the test messages.",
        severity="high" if ping.get("sent", 0) >= 30 else "medium",
        confidence=confidence(0.75, samples=ping.get("sent", 0), needed=10),
        facts=[ev.fact("Router replies", f"{ping['received']} of {ping['sent']}")],
        causes=[{"name": "Weak Wi-Fi or a loose cable", "confidence": 0.45}, {"name": "The router is restarting or overloaded", "confidence": 0.3}, {"name": "The router ignores test messages", "confidence": 0.15}],
        next_step="Check the Wi-Fi signal or cable, then restart the router if needed. JARVIS does not reset network adapters by itself.",
        evidence=[ev],
    )


@rule("D-NET-03", "1.0.0", "network", "intermittent_packet_loss", "net.gateway_ping")
def packet_loss(ctx: Context) -> Result | None:
    ev, ping = _gateway(ctx)
    if not ev or not ping or not ping.get("received"):
        return None
    loss, sent = ping.get("loss_percent", 0), ping.get("sent", 0)
    enough = sent >= 60
    if not ((enough and loss > 2) or (not enough and loss >= 20)):
        return None
    return Result(
        title="Some network traffic is being lost",
        statement=f"{loss:.0f}% of test messages to your router were lost. That causes stutters in calls, games and streams.",
        severity="medium" if enough else "low",
        confidence=confidence(0.7, samples=sent, needed=60),
        facts=[ev.fact("Lost to router", f"{loss:.0f}% of {sent}"), ev.fact("Average reply time", f"{ping.get('avg_ms')} ms")],
        causes=[{"name": "Wi-Fi interference or distance from the router", "confidence": 0.5}],
        next_step="Run the Network scan for a longer test, or try closer to the router or with a cable.",
        limitations=[] if enough else ["Quick test used only a few messages; run the Network scan for a reliable figure."],
        evidence=[ev],
    )


@rule("D-NET-01", "1.0.0", "network", "dns_resolution_failure", "net.dns", "net.gateway_ping")
def dns_failure(ctx: Context) -> Result | None:
    dns = ctx.get("net.dns")
    if not dns or all(d.get("ok") for d in dns.data):
        return None
    _, ping = _gateway(ctx)
    gateway_ok = bool(ping and ping.get("received"))
    failed = [d["name"] for d in dns.data if not d.get("ok")]
    all_failed = len(failed) == len(dns.data)
    return Result(
        title="Web addresses are not being found",
        statement=("None" if all_failed else "Some") + " of the test web names could be looked up, although " + ("your router answers." if gateway_ok else "the network looks connected."),
        severity="medium" if all_failed else "low",
        confidence=confidence(0.75 if all_failed else 0.45, corroborated=gateway_ok),
        facts=[dns.fact(f"Look up {d['name']}", "ok" if d.get("ok") else d.get("error", "failed")) for d in dns.data],
        causes=[{"name": "The DNS server set on this PC or router is not responding", "confidence": 0.55}],
        next_step="Restart the router; if it persists, the internet provider's DNS may be down. JARVIS does not change DNS settings by itself.",
        limitations=["Not concluded to be an internet provider fault without more tests."],
        evidence=[e for e in (dns, ctx.get("net.gateway_ping")) if e],
        actions=[{"tool_id": "network.flush_dns_cache", "arguments": {}}],
    )


@rule("D-NET-04", "1.0.0", "network", "no_internet_path", "net.https", "net.dns", "net.gateway_ping")
def no_internet(ctx: Context) -> Result | None:
    https, dns = ctx.get("net.https"), ctx.get("net.dns")
    _, ping = _gateway(ctx)
    if not https or not dns or not ping or not ping.get("received"):
        return None
    if any(h.get("ok") for h in https.data) or not any(d.get("ok") for d in dns.data):
        return None
    return Result(
        title="The internet cannot be reached",
        statement="Your router answers and web names resolve, but secure websites could not be reached.",
        severity="medium",
        confidence=confidence(0.7, corroborated=True),
        facts=[https.fact(h["url"].split("/")[2], h.get("error") or h.get("status")) for h in https.data],
        causes=[{"name": "Internet provider outage", "confidence": 0.35}, {"name": "A proxy, VPN or firewall is blocking traffic", "confidence": 0.35}],
        next_step="Check if other devices are online. If only this PC is affected, check VPN or proxy settings.",
        evidence=[https, dns],
    )


# ---- Drivers / devices --------------------------------------------------------------

IMPORTANT_CLASSES = {"Display", "Net", "DiskDrive", "SCSIAdapter", "HDC", "System", "Processor", "USB", "AudioEndpoint", "MEDIA", "Bluetooth"}


@rule("D-DRV-01", "1.0.0", "drivers", "device_problem_code", "windows.devices")
def device_problems(ctx: Context) -> Result | None:
    ev = ctx.get("windows.devices")
    devices = [d for d in (ev.data if ev else []) or [] if d.get("problem_code") not in (0, 45) and d.get("present") is not False]
    if not ev or not devices:
        return None
    disabled = [d for d in devices if d.get("problem_code") == 22]
    real = [d for d in devices if d.get("problem_code") != 22]
    target = real or disabled
    first = target[0]
    return Result(
        title=f"A device has a problem: {first.get('name')}" if real else "Some devices are turned off",
        statement=f"Device Manager reports {len(real)} device{'s' if len(real) != 1 else ''} with a problem" + (f" and {len(disabled)} disabled." if disabled else "."),
        severity=("high" if any(d.get("class") in IMPORTANT_CLASSES for d in real) else "medium") if real else "info",
        confidence=confidence(0.9),
        facts=[ev.fact(d.get("name") or "Unknown device", f"code {d.get('problem_code')}: {d.get('problem')}") for d in target[:5]],
        causes=[{"name": first.get("problem") or "Driver problem", "confidence": 0.7}],
        next_step="Reinstalling or updating a driver needs your approval; disabled devices may be off on purpose.",
        evidence=[ev],
    )


@rule("D-BT-01", "1.0.0", "bluetooth", "bluetooth_adapter_unavailable", "windows.bluetooth", "windows.services")
def bluetooth(ctx: Context) -> Result | None:
    ev = ctx.get("windows.bluetooth")
    adapters = (ev.data or {}).get("adapters", []) if ev else []
    broken = [a for a in adapters if a.get("problem_code") or str(a.get("status", "OK")).upper() != "OK"]
    if not ev or not broken:
        return None
    return Result(
        title="Bluetooth is not working",
        statement=f"{broken[0]['name']} reports a problem, so Bluetooth devices may not connect.",
        severity="medium",
        confidence=confidence(0.8),
        facts=[ev.fact(a["name"], f"status {a.get('status')}, code {a.get('problem_code')}") for a in broken],
        causes=[{"name": "Bluetooth turned off, airplane mode or a driver problem", "confidence": 0.6}],
        next_step="Check the Bluetooth switch and airplane mode in Quick Settings. Driver changes need your approval.",
        evidence=[ev],
    )


@rule("D-AUD-01", "1.0.0", "audio", "audio_service_failure", "windows.audio", "windows.services")
def audio(ctx: Context) -> Result | None:
    ev, svc = ctx.get("windows.audio"), ctx.get("windows.services")
    services = {s["name"]: s for s in (svc.data if svc else []) or []}
    stopped = [n for n in ("Audiosrv", "AudioEndpointBuilder") if n in services and services[n].get("state") != "Running"]
    devices = (ev.data if ev else []) or []
    working = [d for d in devices if str(d.get("status", "")).upper() == "OK"]
    if not stopped and (working or not ev):
        return None
    return Result(
        title="Sound may not work",
        statement=("The Windows audio service is not running." if stopped else "No sound device reports as working."),
        severity="medium" if ctx.symptom == "no_sound" else "low",
        confidence=confidence(0.75, corroborated=bool(stopped) and not working),
        facts=([svc.fact(f"{n} service", services[n].get("state")) for n in stopped] if svc else []) + ([ev.fact("Working sound devices", len(working))] if ev else []),
        causes=[{"name": "Audio service stopped", "confidence": 0.6}] if stopped else [{"name": "Sound device disabled or unplugged", "confidence": 0.5}],
        next_step="Check the output device and volume in Quick Settings. JARVIS will not install audio drivers automatically.",
        evidence=[e for e in (ev, svc) if e],
        actions=[{"tool_id": "service.restart_named", "arguments": {"name": n}} for n in stopped],
    )


# ---- Security / services / power ----------------------------------------------------


@rule("D-SEC-01", "1.0.0", "security", "defender_protection_disabled", "windows.security")
def defender(ctx: Context) -> Result | None:
    ev = ctx.get("windows.security")
    if not ev:
        return None
    d = ev.data or {}
    mp = d.get("defender") or {}
    other_av = [a for a in d.get("antivirus_products", []) if "defender" not in str(a.get("name", "")).lower()]
    fw_off = [f["profile"] for f in d.get("firewall", []) if not f.get("enabled")]
    rt_off = bool(mp) and mp.get("realtime") is False
    if not fw_off and not (rt_off and not other_av):
        return None
    problems = (["Real-time virus protection is off"] if rt_off and not other_av else []) + ([f"Firewall is off for {', '.join(fw_off)} networks"] if fw_off else [])
    return Result(
        title="Some protection is turned off",
        statement=". ".join(problems) + ". This can be a deliberate setting or an organisation policy.",
        severity="high",
        confidence=confidence(0.9),
        facts=([ev.fact("Real-time protection", "on" if mp.get("realtime") else "off")] if mp else []) + [ev.fact(f"Firewall ({f['profile']})", "on" if f.get("enabled") else "off") for f in d.get("firewall", [])],
        causes=[{"name": "Turned off in Windows Security or by another app", "confidence": 0.5}],
        next_step="Open Windows Security to review it. JARVIS never changes security settings by itself.",
        evidence=[ev],
    )


USER_WRITABLE = re.compile(r"(?i)\\(appdata|temp|downloads|desktop)\\")


@rule("D-SEC-02", "1.0.0", "security", "untrusted_startup_entry", "windows.startup")
def startup_unsigned(ctx: Context) -> Result | None:
    ev = ctx.get("windows.startup")
    entries = (ev.data if ev else []) or []
    odd = [e for e in entries if e.get("exists") and e.get("signature") not in ("Valid", None) and USER_WRITABLE.search(str(e.get("path") or ""))]
    if not ev or not odd:
        return None
    return Result(
        title="An unsigned app starts with Windows",
        statement=f"{len(odd)} program{'s' if len(odd) > 1 else ''} that start with Windows are not digitally signed and run from a user folder. That is common for small tools, and not proof of anything harmful.",
        severity="medium" if any(e.get("signature") == "HashMismatch" for e in odd) else "low",
        confidence=confidence(0.6),
        facts=[ev.fact(e.get("name") or "startup item", f"{e.get('signature')}, {e.get('path')}") for e in odd[:5]],
        causes=[{"name": "A small or self-updating app installed per user", "confidence": 0.6}, {"name": "Unwanted software (needs a scan to tell)", "confidence": 0.15}],
        next_step="If you do not recognise it, run a Microsoft Defender scan. Startup items are only disabled with your approval.",
        evidence=[ev],
        actions=[{"tool_id": "startup.disable_entry", "arguments": {"name": e["name"]}} for e in odd if _per_user(e)][:3],
    )


def _per_user(entry: dict[str, Any]) -> bool:
    loc = str(entry.get("location") or "")
    # Win32_StartupCommand reports per-user Run entries as "HKU\<sid>\...\Run" and the user Startup folder as "Startup".
    return (loc.startswith(("HKU\\", "HKCU\\")) and loc.endswith("\\Run")) or loc == "Startup"


RESTARTABLE = {"Dnscache", "Dhcp", "Audiosrv", "AudioEndpointBuilder", "Spooler", "bthserv", "WlanSvc", "Schedule", "CryptSvc", "LanmanWorkstation"}
CRITICAL_SERVICES = {"EventLog": "high", "RpcSs": "high", "Winmgmt": "high", "BFE": "high", "mpssvc": "high", "WinDefend": "high", "Dnscache": "medium", "Dhcp": "medium", "nsi": "medium", "CryptSvc": "medium", "Schedule": "medium", "PlugPlay": "medium", "LanmanWorkstation": "low", "wscsvc": "medium", "Audiosrv": "low", "AudioEndpointBuilder": "low"}


@rule("D-SVC-01", "1.0.0", "services", "required_service_stopped", "windows.services")
def services_stopped(ctx: Context) -> Result | None:
    ev = ctx.get("windows.services")
    stopped = [s for s in (ev.data if ev else []) or [] if s.get("name") in CRITICAL_SERVICES and s.get("start") == "Auto" and s.get("state") != "Running"]
    if not ev or not stopped:
        return None
    order = ["low", "medium", "high"]
    sev = max((CRITICAL_SERVICES[s["name"]] for s in stopped), key=order.index)
    return Result(
        title=f"A Windows service is stopped: {stopped[0].get('display')}",
        statement=f"{len(stopped)} service{'s' if len(stopped) > 1 else ''} that should run automatically {'are' if len(stopped) > 1 else 'is'} stopped.",
        severity=sev,
        confidence=confidence(0.85),
        facts=[ev.fact(s.get("display") or s["name"], f"{s.get('state')} (start: {s.get('start')})") for s in stopped],
        causes=[{"name": "The service failed to start or was stopped", "confidence": 0.6}],
        next_step="Restarting a service needs your approval. JARVIS will check its dependencies first.",
        evidence=[ev],
        actions=[{"tool_id": "service.restart_named", "arguments": {"name": s["name"]}} for s in stopped if s["name"] in RESTARTABLE][:3],
    )


@rule("D-BATT-01", "1.0.0", "power", "battery_capacity_degradation", "windows.battery")
def battery(ctx: Context) -> Result | None:
    ev = ctx.get("windows.battery")
    b = (ev.data if ev else None) or {}
    design, full = b.get("design_mwh"), b.get("full_mwh")
    if not ev or not b.get("present") or not design or not full:
        return None
    ratio = full / design
    if ratio >= 0.8:
        return None
    return Result(
        title="The battery holds less charge than it used to",
        statement=f"The battery now holds {ratio:.0%} of the charge it was designed for, so it runs out sooner.",
        severity="medium",
        confidence=confidence(0.85),
        facts=[ev.fact("Full charge capacity", f"{full:,} mWh"), ev.fact("Design capacity", f"{design:,} mWh")] + ([ev.fact("Charge cycles", b["cycles"])] if b.get("cycles") else []),
        causes=[{"name": "Normal battery wear", "confidence": 0.8}],
        next_step="This is normal ageing. A replacement is optional and up to you; check with the PC maker.",
        limitations=["Capacity readings come from the battery itself and vary by maker."],
        evidence=[ev],
    )


# Rules in the spec that this build cannot evaluate yet, and why (shown in scan summaries).
NOT_YET = {
    "D-THERM-01": "Temperature sensors need LibreHardwareMonitor (not installed).",
    "D-THERM-02": "Needs temperature sensors and a baseline.",
    "D-GPU-01": "GPU load counters are not collected yet.",
    "D-BOOT-01": "Boot timing needs at least 3 recorded boots and admin-only event logs.",
    "D-DRV-02": "Driver-change correlation needs driver install history (next round).",
    "D-OS-01": "Runs only after you start an SFC/DISM check, which needs approval.",
    "D-USB-01": "Device connect/disconnect history is not collected yet.",
    "D-ANOM-01": "Needs at least 7 days of baseline samples.",
}
