"""Local REST API (spec §9). Loopback only, per-launch bearer token, no CORS."""

from __future__ import annotations

import json
import secrets
import time
import uuid
from datetime import timedelta
from typing import Any, Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from .. import __version__
from ..assistant import answer as assistant
from ..assistant import ollama
from ..collectors import gpu, system
from ..collectors.sampler import sampler
from ..config import settings
from ..diagnostics import engine, report
from ..diagnostics.rules import NOT_YET, RULES
from ..actions import policy
from ..actions.tools import TOOLS, user_startup_entries
from ..assistant import memory
from ..storage import db

app = FastAPI(title="JARVIS agent", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(status_code=status, detail={"code": code, "message": message})


@app.middleware("http")
async def guard(request: Request, call_next):  # noqa: ANN001
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    host = request.headers.get("host", "")
    if host not in (f"127.0.0.1:{settings.port}", f"localhost:{settings.port}", "testserver"):
        return _error(421, "FORBIDDEN", "Wrong host", request_id)
    if request.headers.get("origin") or request.headers.get("sec-fetch-site") == "cross-site":
        # Browsers send Origin on cross-origin calls; only the host process talks to the agent.
        return _error(403, "FORBIDDEN", "Cross-origin requests are not accepted", request_id)
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    response.headers["cache-control"] = "no-store"
    return response


def _error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse({"code": code, "message": message, "request_id": request_id}, status_code=status, headers={"x-request-id": request_id})


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):  # noqa: ANN001
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "INTERNAL_ERROR", "message": str(exc.detail)}
    return _error(exc.status_code, detail["code"], detail["message"], getattr(request.state, "request_id", ""))


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):  # noqa: ANN001
    return _error(422, "VALIDATION_ERROR", "Malformed request", getattr(request.state, "request_id", ""))


@app.exception_handler(Exception)
async def internal_error(request: Request, exc: Exception):  # noqa: ANN001
    db.audit("api.error", f"Internal error: {type(exc).__name__}")
    return _error(500, "INTERNAL_ERROR", "Something went wrong inside the agent", getattr(request.state, "request_id", ""))


def require_token(authorization: str = Header(default="")) -> None:
    expected = f"Bearer {settings.token}"
    if not settings.token or not secrets.compare_digest(authorization.encode(), expected.encode()):
        raise ApiError(401, "AUTH_REQUIRED", "Missing or invalid local token")


api = Depends(require_token)


# ---- health / system -----------------------------------------------------------


@app.get("/api/v1/health", dependencies=[api])
def health() -> dict[str, Any]:
    latest = sampler.latest()
    return {
        "status": "ok",
        "version": __version__,
        "db": "ok",
        "sampler": {"running": latest is not None, "last_sample": db.iso(latest.at) if latest else None},
        "model": ollama.status(),
        "scan_running": engine.is_running(),
    }


@app.get("/api/v1/system/summary", dependencies=[api])
def system_summary() -> dict[str, Any]:
    latest = sampler.latest()
    mem = system.memory()
    vols = system.volumes()
    sys_vol = next((v for v in vols if v.get("is_system")), None)
    return {
        "observed_at": db.iso(latest.at) if latest else db.iso(db.now()),
        "os": system.os_info(),
        "cpu_percent": latest.cpu if latest else system.cpu(0.3)["percent"],
        "memory": mem,
        "system_volume": sys_vol,
        "disk_busy_percent": latest.disk_busy if latest else None,
        "net_recv_bps": latest.net_recv_bps if latest else None,
        "net_sent_bps": latest.net_sent_bps if latest else None,
        "network_interfaces": system.network_interfaces(),
    }


@app.get("/api/v1/system/gpu", dependencies=[api])
def system_gpu() -> dict[str, Any]:
    """GPU temperature, load and VRAM from nvidia-smi (cached 5 s)."""
    return gpu.read()


@app.get("/api/v1/system/inventory", dependencies=[api])
def inventory() -> dict[str, Any]:
    return {"os": system.os_info(), "volumes": system.volumes(), "network_interfaces": system.network_interfaces()}


@app.get("/api/v1/metrics/current", dependencies=[api])
def metrics_current() -> dict[str, Any]:
    s = sampler.latest()
    if not s:
        raise ApiError(503, "COLLECTOR_UNAVAILABLE", "The sampler has no data yet")
    return {
        "observed_at": db.iso(s.at),
        "freshness_seconds": round((db.now() - s.at).total_seconds(), 1),
        "cpu_percent": s.cpu,
        "memory_used_percent": s.mem_percent,
        "memory_available_bytes": s.mem_available,
        "disk_busy_percent": s.disk_busy,
        "disk_read_bps": s.disk_read_bps,
        "disk_write_bps": s.disk_write_bps,
        "net_recv_bps": s.net_recv_bps,
        "net_sent_bps": s.net_sent_bps,
        "sources": {"cpu": "psutil.cpu_percent", "memory": "psutil.virtual_memory", "disk": "psutil.disk_io_counters", "network": "psutil.net_io_counters"},
    }


@app.get("/api/v1/metrics/history", dependencies=[api])
def metrics_history(minutes: int = Query(60, ge=1, le=24 * 60), points: int = Query(120, ge=10, le=600)) -> dict[str, Any]:
    since = db.now() - timedelta(minutes=minutes)
    with db.session() as s:
        rows = s.scalars(select(db.MetricSample).where(db.MetricSample.observed_at >= since).order_by(db.MetricSample.observed_at)).all()
        data = [(r.observed_at, r.cpu_percent, r.memory_percent, r.disk_busy_percent, r.net_recv_bps, r.net_sent_bps) for r in rows]
    step = max(1, len(data) // points)
    series = []
    for i in range(0, len(data), step):
        chunk = data[i : i + step]
        avg = lambda idx: (sum(x[idx] for x in chunk if x[idx] is not None) / max(1, sum(1 for x in chunk if x[idx] is not None))) if any(x[idx] is not None for x in chunk) else None  # noqa: E731
        series.append({"t": db.iso(chunk[-1][0]), "cpu": avg(1), "memory": avg(2), "disk": avg(3), "net_recv": avg(4), "net_sent": avg(5)})
    return {"minutes": minutes, "points": series, "source": "jarvis sampler (10 s samples, averaged)"}


@app.get("/api/v1/processes", dependencies=[api])
def processes(limit: int = Query(25, ge=1, le=100)) -> dict[str, Any]:
    rows = sampler.latest_processes(limit)
    with sampler.lock:
        at = sampler.processes[-1].at if sampler.processes else None
    return {"observed_at": db.iso(at), "processes": rows[:limit], "note": "CPU is averaged over the last 30 seconds."}


# ---- diagnostics -----------------------------------------------------------------


class StartScan(BaseModel):
    profile: Literal["quick_health", "performance", "network", "stability", "hardware", "full"] = "quick_health"
    symptom: Literal["slow_pc", "app_freeze", "no_sound", "no_internet"] | None = None
    reason: str = Field("user_requested", max_length=40)


def _session_json(row: db.DiagnosticSession, findings: list[db.Finding] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "session_id": row.id,
        "profile": row.profile,
        "label": engine.PROFILES[row.profile]["label"],
        "status": row.status,
        "progress": row.progress,
        "summary": row.summary,
        "created_at": db.iso(row.created_at),
        "finished_at": db.iso(row.finished_at),
    }
    if findings is not None:
        out["findings"] = [_finding_json(f) for f in findings]
    return out


def _finding_json(f: db.Finding) -> dict[str, Any]:
    return {
        "finding_id": f.id, "session_id": f.session_id, "rule_id": f.rule_id, "rule_version": f.rule_version, "category": f.category,
        "title": f.title, "statement": f.statement, "severity": f.severity, "confidence": f.confidence, "status": f.status,
        "facts": f.facts, "likely_causes": f.likely_causes, "next_step": f.next_step, "limitations": f.limitations,
        "evidence_ids": f.evidence_ids, "created_at": db.iso(f.created_at),
        "suggested_actions": [
            {**a, "title": TOOLS[a["tool_id"]].title, "risk_class": TOOLS[a["tool_id"]].risk_class} for a in (f.suggested_actions or []) if a.get("tool_id") in TOOLS
        ],
    }


@app.post("/api/v1/diagnostics/sessions", dependencies=[api], status_code=201)
def start_scan(body: StartScan) -> dict[str, Any]:
    if engine.is_running():
        raise ApiError(429, "RATE_LIMITED", "A scan is already running")
    session_id = engine.start_session(body.profile, body.symptom, body.reason)
    return {"session_id": session_id, "status": "queued", "created_at": db.iso(db.now())}


@app.get("/api/v1/diagnostics/sessions", dependencies=[api])
def list_scans(limit: int = Query(20, ge=1, le=100)) -> dict[str, Any]:
    with db.session() as s:
        rows = s.scalars(select(db.DiagnosticSession).order_by(db.DiagnosticSession.created_at.desc()).limit(limit)).all()
        return {"sessions": [_session_json(r) for r in rows]}


@app.get("/api/v1/diagnostics/sessions/{session_id}", dependencies=[api])
def get_scan(session_id: str) -> dict[str, Any]:
    with db.session() as s:
        row = s.get(db.DiagnosticSession, session_id)
        if not row:
            raise ApiError(404, "NOT_FOUND", "Unknown scan")
        findings = s.scalars(select(db.Finding).where(db.Finding.session_id == session_id)).all()
        return _session_json(row, list(findings))


@app.get("/api/v1/diagnostics/profiles", dependencies=[api])
def profiles() -> dict[str, Any]:
    return {
        "profiles": [{"id": k, "label": v["label"]} for k, v in engine.PROFILES.items()],
        "rules": [{"id": r.id, "version": r.version, "category": r.category, "name": r.name} for r in RULES],
        "rules_not_available": NOT_YET,
    }


@app.get("/api/v1/findings", dependencies=[api])
def findings(severity: str | None = None, limit: int = Query(50, ge=1, le=100)) -> dict[str, Any]:
    with db.session() as s:
        q = select(db.Finding).order_by(db.Finding.created_at.desc()).limit(limit)
        if severity:
            q = q.where(db.Finding.severity == severity)
        return {"findings": [_finding_json(f) for f in s.scalars(q).all()]}


@app.get("/api/v1/findings/{finding_id}", dependencies=[api])
def finding(finding_id: str) -> dict[str, Any]:
    with db.session() as s:
        f = s.get(db.Finding, finding_id)
        if not f:
            raise ApiError(404, "NOT_FOUND", "Unknown finding")
        evidence = s.scalars(select(db.EvidenceItem).where(db.EvidenceItem.id.in_(f.evidence_ids or []))).all()
        out = _finding_json(f)
        out["evidence"] = [
            {"evidence_id": e.id, "collector_id": e.collector_id, "evidence_type": e.evidence_type, "source": e.source, "observed_at": db.iso(e.observed_at), "quality": e.quality, "limitations": e.limitations}
            for e in evidence
        ]
        return out


class ExportRequest(BaseModel):
    session_id: str = Field(max_length=40)
    format: Literal["json", "html"] = "html"


@app.post("/api/v1/exports", dependencies=[api], status_code=201)
def create_export(body: ExportRequest) -> dict[str, Any]:
    result = report.export(body.session_id, body.format)
    if not result:
        raise ApiError(404, "NOT_FOUND", "Unknown scan")
    return result


# ---- assistant ------------------------------------------------------------------


class Turn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    conversation_id: str | None = Field(None, max_length=40)


def _sse(event: str, data: Any, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.post("/api/v1/assistant/turns", dependencies=[api])
def assistant_turn(body: Turn, stream: bool = Query(False)):
    """Answer a question. With ?stream=1 the answer arrives as SSE: assistant.delta pieces,
    assistant.replace (when the AI text must be swapped for rule text), assistant.done."""
    if not stream:
        return assistant.answer(body.text, body.conversation_id)

    def events():
        n = 0
        for kind, value in assistant.answer_events(body.text, body.conversation_id):
            n += 1
            yield _sse(f"assistant.{kind}", {"text": value} if kind != "done" else value, n)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})


@app.get("/api/v1/diagnostics/sessions/{session_id}/events", dependencies=[api])
def scan_events(session_id: str):
    """Scan progress as SSE (spec §9.4): collector.progress, finding.created, session.completed."""
    with db.session() as s:
        if not s.get(db.DiagnosticSession, session_id):
            raise ApiError(404, "NOT_FOUND", "Unknown scan")

    def events():
        sent_steps: dict[str, str] = {}
        n = 0
        deadline = time.monotonic() + 15 * 60
        last_beat = time.monotonic()
        yield _sse("session.started", {"session_id": session_id}, n)
        while time.monotonic() < deadline:
            with db.session() as s:
                row = s.get(db.DiagnosticSession, session_id)
                progress = list(row.progress or []) if row else []
                status = row.status if row else "failed"
                summary = dict(row.summary or {}) if row else {}
                findings = s.scalars(select(db.Finding).where(db.Finding.session_id == session_id)).all() if status == "completed" else []
                found = [{"finding_id": f.id, "severity": f.severity, "title": f.title} for f in findings]
            for p in progress:
                if sent_steps.get(p["collector_id"]) != p["status"]:
                    sent_steps[p["collector_id"]] = p["status"]
                    n += 1
                    yield _sse("collector.progress", p, n)
            if status in ("completed", "failed"):
                for f in found:
                    n += 1
                    yield _sse("finding.created", f, n)
                n += 1
                yield _sse("session.completed", {"session_id": session_id, "status": status, "summary": summary}, n)
                return
            if time.monotonic() - last_beat > 10:
                last_beat = time.monotonic()
                yield ": keep-alive\n\n"
            time.sleep(0.5)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})


@app.get("/api/v1/assistant/model", dependencies=[api])
def model_status() -> dict[str, Any]:
    return ollama.status()


# ---- audit / settings ---------------------------------------------------------------


@app.get("/api/v1/audit", dependencies=[api])
def audit(limit: int = Query(50, ge=1, le=100)) -> dict[str, Any]:
    with db.session() as s:
        rows = s.scalars(select(db.AuditEvent).order_by(db.AuditEvent.at.desc()).limit(limit)).all()
        total = s.scalar(select(func.count()).select_from(db.AuditEvent))
        return {"total": total, "events": [{"at": db.iso(r.at), "kind": r.kind, "summary": r.summary} for r in rows]}


class Preferences(BaseModel):
    model: str | None = Field(None, max_length=60, pattern=r"^[A-Za-z0-9._:/-]+$")
    auto_safe_fixes: bool | None = None
    memory_enabled: bool | None = None


@app.get("/api/v1/settings/preferences", dependencies=[api])
def get_preferences() -> dict[str, Any]:
    return {
        "model": ollama.model_name(),
        "sample_seconds": settings.sample_seconds,
        "history_hours": settings.history_hours,
        "auto_safe_fixes": policy.auto_safe_enabled(),
        "memory_enabled": memory.enabled(),
        "conversation_retention_days": 30,
    }


@app.put("/api/v1/settings/preferences", dependencies=[api])
def put_preferences(body: Preferences) -> dict[str, Any]:
    if body.model:
        db.set_pref("model", body.model)
        db.audit("settings.changed", f"AI model set to {body.model}")
    if body.auto_safe_fixes is not None:
        db.set_pref("auto_safe_fixes", "on" if body.auto_safe_fixes else "off")
        db.audit("settings.changed", f"Automatic safe fixes turned {'on' if body.auto_safe_fixes else 'off'}")
    if body.memory_enabled is not None:
        db.set_pref("memory_enabled", "on" if body.memory_enabled else "off")
        db.audit("settings.changed", f"Long-term memory turned {'on' if body.memory_enabled else 'off'}")
    return get_preferences()


# ---- tools and actions (spec §12) ---------------------------------------------------------


def _policy_call(fn, *args):  # noqa: ANN001, ANN002
    try:
        return fn(*args)
    except policy.PolicyError as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc


@app.get("/api/v1/tools", dependencies=[api])
def tools() -> dict[str, Any]:
    return {"tools": [t.describe() for t in TOOLS.values()], "auto_safe_fixes": policy.auto_safe_enabled()}


class ProposeAction(BaseModel):
    tool_id: str = Field(max_length=60)
    arguments: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field("", max_length=500)
    source_finding_ids: list[str] = Field(default_factory=list, max_length=5)


@app.post("/api/v1/actions", dependencies=[api], status_code=201)
def propose_action(body: ProposeAction) -> dict[str, Any]:
    return _policy_call(policy.propose, body.tool_id, body.arguments, body.reason, body.source_finding_ids)


@app.get("/api/v1/actions", dependencies=[api])
def list_actions(limit: int = Query(30, ge=1, le=100)) -> dict[str, Any]:
    return {"actions": policy.list_actions(limit)}


@app.get("/api/v1/actions/{action_id}", dependencies=[api])
def get_action(action_id: str) -> dict[str, Any]:
    return _policy_call(policy.get, action_id)


class Approve(BaseModel):
    argument_hash: str = Field(max_length=80)
    approval_scope: Literal["this_action_once"] = "this_action_once"


@app.post("/api/v1/actions/{action_id}/approve", dependencies=[api])
def approve_action(action_id: str, body: Approve) -> dict[str, Any]:
    return _policy_call(policy.approve, action_id, body.argument_hash)


@app.post("/api/v1/actions/{action_id}/reject", dependencies=[api])
def reject_action(action_id: str) -> dict[str, Any]:
    return _policy_call(policy.reject, action_id)


@app.post("/api/v1/actions/{action_id}/execute", dependencies=[api])
def execute_action(action_id: str) -> dict[str, Any]:
    return _policy_call(policy.execute, action_id)


@app.post("/api/v1/actions/{action_id}/rollback", dependencies=[api])
def rollback_action(action_id: str) -> dict[str, Any]:
    return _policy_call(policy.rollback, action_id)


@app.get("/api/v1/startup", dependencies=[api])
def startup_entries() -> dict[str, Any]:
    """Per-user startup items JARVIS can switch with your approval (names only)."""
    return {"entries": user_startup_entries()}


# ---- memory (spec §13.3) ----------------------------------------------------------------------


def _memory_call(fn, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
    try:
        return fn(*args, **kwargs)
    except memory.MemoryError_ as exc:
        raise ApiError(exc.status, exc.code, exc.message) from exc


class NewMemory(BaseModel):
    text: str = Field(min_length=1, max_length=300)


class EditMemory(BaseModel):
    text: str | None = Field(None, min_length=1, max_length=300)
    approve: bool | None = None


@app.get("/api/v1/memories", dependencies=[api])
def memories() -> dict[str, Any]:
    return {"enabled": memory.enabled(), "memories": memory.list_all()}


@app.post("/api/v1/memories", dependencies=[api], status_code=201)
def add_memory(body: NewMemory) -> dict[str, Any]:
    return _memory_call(memory.create, body.text, source="user")


@app.patch("/api/v1/memories/{memory_id}", dependencies=[api])
def edit_memory(memory_id: str, body: EditMemory) -> dict[str, Any]:
    return _memory_call(memory.update, memory_id, text=body.text, approve=body.approve)


@app.delete("/api/v1/memories/{memory_id}", dependencies=[api])
def delete_memory(memory_id: str) -> dict[str, Any]:
    return {"deleted": _memory_call(memory.delete, memory_id)}


@app.delete("/api/v1/memories", dependencies=[api])
def delete_all_memories() -> dict[str, Any]:
    return {"deleted": memory.delete()}


@app.delete("/api/v1/assistant/conversations", dependencies=[api])
def clear_conversations() -> dict[str, Any]:
    with db.session() as s:
        n = s.execute(db.ConversationTurn.__table__.delete()).rowcount
    db.audit("conversation.cleared", "Conversation history deleted")
    return {"deleted": n}
