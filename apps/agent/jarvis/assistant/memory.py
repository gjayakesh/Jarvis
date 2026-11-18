"""Long-term memory (spec §13.3, threat "sensitive memory leakage").

Off until the user turns it on. Facts asked for by voice or chat stay *pending*
until the user approves them. Secrets are refused outright. Saved facts are
given to the assistant as context, never as instructions.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select

from ..security.redaction import redact_text
from ..storage import db

MAX_FACTS = 200
SECRET = re.compile(
    r"(?i)\b(password|passcode|passwd|pin( code)?|otp|one[- ]time code|api[- ]?key|secret|token|private key|cvv|credit card|debit card|bank account|ssn|aadhaar|pan card)\b"
    r"|\b(?:\d[ -]?){12,19}\b"
)


class MemoryError_(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def enabled() -> bool:
    return db.get_pref("memory_enabled", "off") == "on"


def _check(text: str) -> str:
    clean = " ".join(text.split()).strip(" .")
    if not clean or len(clean) > 300:
        raise MemoryError_(422, "VALIDATION_ERROR", "A memory must be a short sentence (up to 300 characters).")
    if SECRET.search(clean):
        raise MemoryError_(422, "VALIDATION_ERROR", "JARVIS never stores passwords, codes, keys or card and account numbers.")
    return clean


def _json(m: db.Memory) -> dict[str, Any]:
    return {"memory_id": m.id, "text": m.text, "status": m.status, "source": m.source, "created_at": db.iso(m.created_at), "updated_at": db.iso(m.updated_at)}


def create(text: str, *, source: str = "user", pending: bool = False) -> dict[str, Any]:
    if not enabled():
        raise MemoryError_(403, "FORBIDDEN", "Long-term memory is off. Turn it on in Settings first.")
    clean = _check(text)
    with db.session() as s:
        count = len(s.scalars(select(db.Memory.id)).all())
        if count >= MAX_FACTS:
            raise MemoryError_(429, "RATE_LIMITED", "Memory is full. Delete some facts first.")
        m = db.Memory(id=db.new_id("mem"), text=clean, status="pending" if pending else "saved", source=source)
        s.add(m)
        out = _json(m)
    db.audit("memory.created", "A memory was proposed" if pending else "A memory was saved", {"memory_id": out["memory_id"], "source": source})
    return out


def list_all() -> list[dict[str, Any]]:
    with db.session() as s:
        return [_json(m) for m in s.scalars(select(db.Memory).order_by(db.Memory.created_at.desc())).all()]


def saved_facts() -> list[str]:
    if not enabled():
        return []
    with db.session() as s:
        return [m.text for m in s.scalars(select(db.Memory).where(db.Memory.status == "saved").order_by(db.Memory.created_at)).all()][:50]


def update(memory_id: str, *, text: str | None = None, approve: bool | None = None) -> dict[str, Any]:
    with db.session() as s:
        m = s.get(db.Memory, memory_id)
        if not m:
            raise MemoryError_(404, "NOT_FOUND", "Unknown memory")
        if text is not None:
            m.text = _check(text)
        if approve:
            m.status = "saved"
        m.updated_at = db.now()
        out = _json(m)
    db.audit("memory.updated", "A memory was approved" if approve else "A memory was edited", {"memory_id": memory_id})
    return out


def delete(memory_id: str | None = None) -> int:
    with db.session() as s:
        if memory_id:
            m = s.get(db.Memory, memory_id)
            if not m:
                raise MemoryError_(404, "NOT_FOUND", "Unknown memory")
            s.delete(m)
            n = 1
        else:
            rows = s.scalars(select(db.Memory)).all()
            for m in rows:
                s.delete(m)
            n = len(rows)
    db.audit("memory.deleted", f"{n} memor{'y' if n == 1 else 'ies'} deleted")
    return n


REMEMBER = re.compile(r"(?i)^\s*(?:please\s+)?remember(?:\s+that)?\s+(.+)$")
RECALL = re.compile(r"(?i)\b(what do you (remember|know) about me|what have you remembered|list (my )?memories)\b")
FORGET = re.compile(r"(?i)^\s*forget (everything|all)( you know)?( about me)?\s*$")


def handle_chat(text: str) -> str | None:
    """Memory requests inside the conversation. Returns the answer, or None if not a memory request."""
    m = REMEMBER.match(text)
    if m:
        if not enabled():
            return "Long-term memory is off, so I won't keep that. You can turn it on in Settings, under Memory."
        try:
            create(redact_text(m.group(1)), source="conversation", pending=True)
        except MemoryError_ as exc:
            return exc.message
        return "I'd like to remember that. Approve it in Settings, under Memory, and I'll keep it."
    if RECALL.search(text):
        facts = saved_facts()
        if not enabled():
            return "Long-term memory is off, so I don't keep facts about you."
        return "I remember: " + "; ".join(facts) + "." if facts else "I haven't saved anything about you yet."
    if FORGET.match(text):
        # Permanent deletion is never done from a single spoken sentence.
        return "You can delete what I remember in Settings, under Memory. It asks you to confirm first."
    return None
