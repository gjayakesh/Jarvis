"""Policy engine and action lifecycle (spec §12.1, §12.4).

PROPOSED -> POLICY_EVALUATED -> AUTO_AUTHORIZED | AWAITING_APPROVAL | DENIED
AWAITING_APPROVAL -> APPROVED -> (precondition check) -> EXECUTING -> VERIFYING -> VERIFIED | NOT_VERIFIED | FAILED
any state before execution -> EXPIRED | CANCELLED
VERIFIED | NOT_VERIFIED -> ROLLING_BACK -> ROLLED_BACK | ROLLBACK_FAILED

Approval binds to action_id + tool_version + normalized argument hash + expiry.
Any argument change, different tool version or expired grant invalidates it.
"""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import timedelta
from typing import Any

from pydantic import ValidationError

from ..storage import db
from .tools import TOOLS, Outcome, Tool

PROPOSAL_TTL = timedelta(minutes=5)


class PolicyError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def argument_hash(tool: Tool, args: dict[str, Any]) -> str:
    canonical = json.dumps({"tool_id": tool.tool_id, "version": tool.version, "arguments": args}, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()


def auto_safe_enabled() -> bool:
    return db.get_pref("auto_safe_fixes", "off") == "on"


def _aware(dt):  # noqa: ANN001, ANN202
    return dt if dt.tzinfo else dt.replace(tzinfo=db.now().tzinfo)


def to_json(a: db.ActionProposal) -> dict[str, Any]:
    tool = TOOLS.get(a.tool_id)
    return {
        "action_id": a.id,
        "tool_id": a.tool_id,
        "tool_version": a.tool_version,
        "title": tool.title if tool else a.tool_id,
        "risk_class": a.risk_class,
        "arguments": a.arguments,
        "argument_hash": a.argument_hash,
        "reason": a.reason,
        "source_finding_ids": a.source_finding_ids,
        "status": a.status,
        "decision": a.decision,
        "approval_copy": a.approval_copy,
        "result": a.result,
        "verification": a.verification,
        "can_rollback": bool(tool and tool.rollback and a.status in ("VERIFIED", "NOT_VERIFIED")),
        "created_at": db.iso(a.created_at),
        "expires_at": db.iso(a.expires_at),
        "approved_at": db.iso(a.approved_at),
        "finished_at": db.iso(a.finished_at),
    }


def propose(tool_id: str, arguments: dict[str, Any], reason: str = "", finding_ids: list[str] | None = None) -> dict[str, Any]:
    tool = TOOLS.get(tool_id)
    if not tool:
        raise PolicyError(404, "NOT_FOUND", "Unknown tool")
    try:
        args = tool.args.model_validate(arguments).model_dump()
    except ValidationError as exc:
        raise PolicyError(422, "VALIDATION_ERROR", f"Invalid arguments for {tool_id}") from exc
    if not tool.available or tool.risk_class == "R3":
        decision, status = "denied", "DENIED"
    # A tool that needs the Windows admin prompt is never automatic: only the user can answer it.
    elif tool.risk_class == "R0" or (tool.risk_class == "R1" and auto_safe_enabled() and not tool.needs_elevation):
        decision, status = "auto_allowed", "AUTO_AUTHORIZED"
    else:
        decision, status = "approval_required", "AWAITING_APPROVAL"
    row = db.ActionProposal(
        id=db.new_id("act"),
        tool_id=tool.tool_id,
        tool_version=tool.version,
        risk_class=tool.risk_class,
        arguments=args,
        argument_hash=argument_hash(tool, args),
        reason=reason[:500],
        source_finding_ids=finding_ids or [],
        status=status,
        decision=decision,
        approval_copy={
            "action": tool.approval(args) if tool.available else tool.unavailable_reason,
            "what_it_does": tool.description,
            "affects": tool.side_effects,
            "undo": tool.undo,
            "needs_admin_prompt": tool.needs_elevation,
        },
        expires_at=db.now() + PROPOSAL_TTL,
        rollback_state={},
    )
    with db.session() as s:
        s.add(row)
    db.audit("action.proposed", f"{tool.title}: {decision.replace('_', ' ')}", {"action_id": row.id, "tool_id": tool.tool_id, "argument_hash": row.argument_hash})
    return to_json(row)


def _load(s, action_id: str) -> db.ActionProposal:  # noqa: ANN001
    row = s.get(db.ActionProposal, action_id)
    if not row:
        raise PolicyError(404, "NOT_FOUND", "Unknown action")
    return row


def _expire_if_due(row: db.ActionProposal) -> None:
    if row.status in ("AWAITING_APPROVAL", "APPROVED", "AUTO_AUTHORIZED") and db.now() > _aware(row.expires_at):
        row.status = "EXPIRED"


def approve(action_id: str, given_hash: str) -> dict[str, Any]:
    with db.session() as s:
        row = _load(s, action_id)
        _expire_if_due(row)
        if row.status == "EXPIRED":
            raise PolicyError(410, "APPROVAL_EXPIRED", "This proposal expired. Ask for it again to see the current details.")
        if row.status != "AWAITING_APPROVAL":
            raise PolicyError(409, "APPROVAL_REQUIRED", f"This action is {row.status.lower().replace('_', ' ')}, not waiting for approval.")
        tool = TOOLS[row.tool_id]
        if tool.version != row.tool_version or argument_hash(tool, row.arguments) != row.argument_hash or given_hash != row.argument_hash:
            raise PolicyError(412, "PRECONDITION_FAILED", "The action changed since you saw it. Review it again.")
        row.status = "APPROVED"
        row.approved_at = db.now()
        # The approval grant itself is short-lived too.
        row.expires_at = db.now() + PROPOSAL_TTL
        out = to_json(row)
    db.audit("action.approved", f"You approved: {out['approval_copy']['action']}", {"action_id": action_id, "argument_hash": given_hash})
    return out


def reject(action_id: str) -> dict[str, Any]:
    with db.session() as s:
        row = _load(s, action_id)
        if row.status not in ("AWAITING_APPROVAL", "APPROVED", "AUTO_AUTHORIZED"):
            raise PolicyError(409, "APPROVAL_REQUIRED", "This action can no longer be rejected.")
        row.status = "CANCELLED"
        row.finished_at = db.now()
        out = to_json(row)
    db.audit("action.rejected", f"You declined: {out['title']}", {"action_id": action_id})
    return out


def execute(action_id: str) -> dict[str, Any]:
    with db.session() as s:
        row = _load(s, action_id)
        _expire_if_due(row)
        if row.status in ("VERIFIED", "NOT_VERIFIED", "FAILED", "ROLLED_BACK"):
            return to_json(row)  # idempotent: already ran
        if row.status == "EXPIRED":
            raise PolicyError(410, "APPROVAL_EXPIRED", "The approval expired before it ran.")
        if row.status == "AWAITING_APPROVAL":
            raise PolicyError(409, "APPROVAL_REQUIRED", "This action needs your approval first.")
        if row.status not in ("APPROVED", "AUTO_AUTHORIZED"):
            raise PolicyError(403, "FORBIDDEN", f"This action is {row.status.lower()}.")
        tool = TOOLS[row.tool_id]
        if not tool.execute or tool.version != row.tool_version or argument_hash(tool, row.arguments) != row.argument_hash:
            raise PolicyError(412, "PRECONDITION_FAILED", "The tool or its arguments changed; approval no longer applies.")
        reason = tool.precondition(row.arguments) if tool.precondition else None
        if reason:
            row.status = "FAILED"
            row.result = {"ok": False, "summary": reason}
            row.finished_at = db.now()
            out = to_json(row)
            db.audit("action.precondition_failed", f"{tool.title}: {reason}", {"action_id": action_id})
            raise PolicyError(412, "PRECONDITION_FAILED", reason)
        row.status = "EXECUTING"
        args = dict(row.arguments)
    db.audit("action.executing", f"Running: {tool.title}", {"action_id": action_id, "tool_id": tool.tool_id})
    if tool.background:
        threading.Thread(target=_finish, args=(action_id, tool, args), name=f"action-{action_id}", daemon=True).start()
        return get(action_id)
    return _finish(action_id, tool, args)


def _finish(action_id: str, tool: Tool, args: dict[str, Any]) -> dict[str, Any]:
    try:
        outcome: Outcome = tool.execute(args)
    except Exception as exc:  # report, never crash the agent
        outcome = Outcome(False, f"The action failed ({type(exc).__name__}).")
    verification: dict[str, Any] = {}
    if outcome.ok and tool.verify:
        try:
            verification = tool.verify(args, outcome)
        except Exception as exc:
            verification = {"verified": False, "summary": f"Could not verify ({type(exc).__name__})."}
    with db.session() as s:
        row = _load(s, action_id)
        row.result = {"ok": outcome.ok, "summary": outcome.summary, **{k: v for k, v in outcome.details.items() if k in ("exit_code", "final", "files", "bytes")}}
        row.verification = {k: v for k, v in verification.items() if k != "evidence"}
        row.rollback_state = outcome.rollback_state or {}
        row.status = "FAILED" if not outcome.ok else ("VERIFIED" if verification.get("verified", True) else "NOT_VERIFIED")
        row.finished_at = db.now()
        out = to_json(row)
    db.audit("action.completed", f"{tool.title}: {out['status'].lower().replace('_', ' ')}. {outcome.summary}", {"action_id": action_id, "verified": verification.get("verified")})
    return out


def rollback(action_id: str) -> dict[str, Any]:
    with db.session() as s:
        row = _load(s, action_id)
        tool = TOOLS[row.tool_id]
        if not tool.rollback or row.status not in ("VERIFIED", "NOT_VERIFIED"):
            raise PolicyError(409, "FORBIDDEN", "This action cannot be undone.")
        state = dict(row.rollback_state or {})
        args = dict(row.arguments)
    try:
        outcome = tool.rollback(args, state)
    except Exception as exc:
        outcome = Outcome(False, f"Undo failed ({type(exc).__name__}).")
    with db.session() as s:
        row = _load(s, action_id)
        row.status = "ROLLED_BACK" if outcome.ok else "ROLLBACK_FAILED"
        row.result = {**(row.result or {}), "rollback": outcome.summary}
        out = to_json(row)
    db.audit("action.rolled_back" if outcome.ok else "action.rollback_failed", f"{tool.title}: {outcome.summary}", {"action_id": action_id})
    return out


def get(action_id: str) -> dict[str, Any]:
    with db.session() as s:
        row = _load(s, action_id)
        _expire_if_due(row)
        return to_json(row)


def list_actions(limit: int = 30) -> list[dict[str, Any]]:
    from sqlalchemy import select

    with db.session() as s:
        rows = s.scalars(select(db.ActionProposal).order_by(db.ActionProposal.created_at.desc()).limit(limit)).all()
        for r in rows:
            _expire_if_due(r)
        return [to_json(r) for r in rows]
