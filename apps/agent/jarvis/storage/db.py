"""SQLite storage (spec §10): WAL, foreign keys, busy timeout, explicit transactions.

The subset of the spec's schema that G0–G3 need. Schema changes go through
`SCHEMA_VERSION` + `_migrate`; Alembic can take over when the schema grows.
"""

from __future__ import annotations

import json
import secrets
import threading
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Iterator

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String, Text, create_engine, event, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from ..config import settings

SCHEMA_VERSION = 2


def now() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime | None) -> str | None:
    if not dt:
        return None
    # SQLite hands datetimes back without a zone; everything is stored in UTC.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).isoformat().replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class MetricSample(Base):
    """10-second system samples, kept for `history_hours` (bounded ring)."""

    __tablename__ = "metric_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    observed_at: Mapped[datetime] = mapped_column(index=True)
    cpu_percent: Mapped[float] = mapped_column(Float)
    memory_percent: Mapped[float] = mapped_column(Float)
    memory_available: Mapped[float] = mapped_column(Float)
    disk_busy_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_read_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    disk_write_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_recv_bps: Mapped[float | None] = mapped_column(Float, nullable=True)
    net_sent_bps: Mapped[float | None] = mapped_column(Float, nullable=True)


class DiagnosticSession(Base):
    __tablename__ = "diagnostic_sessions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    profile: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String)  # queued | running | completed | failed
    reason: Mapped[str] = mapped_column(String, default="user_requested")
    progress: Mapped[list[Any]] = mapped_column(JSON, default=list)  # [{collector_id, status, message}]
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    evidence: Mapped[list["EvidenceItem"]] = relationship(back_populates="session", cascade="all, delete-orphan")
    findings: Mapped[list["Finding"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class EvidenceItem(Base):
    """Normalized evidence (spec Appendix A); free text is redacted before it is stored."""

    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"), index=True)
    collector_id: Mapped[str] = mapped_column(String)
    evidence_type: Mapped[str] = mapped_column(String, index=True)
    source: Mapped[str] = mapped_column(String)
    observed_at: Mapped[datetime] = mapped_column()
    quality: Mapped[str] = mapped_column(String)  # valid | partial | unsupported | error
    data: Mapped[dict[str, Any]] = mapped_column(JSON)
    units: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    limitations: Mapped[list[Any]] = mapped_column(JSON, default=list)
    session: Mapped[DiagnosticSession] = relationship(back_populates="evidence")


class Finding(Base):
    __tablename__ = "findings"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"), index=True)
    rule_id: Mapped[str] = mapped_column(String, index=True)
    rule_version: Mapped[str] = mapped_column(String)
    category: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    statement: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String)  # info | low | medium | high | critical
    confidence: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String, default="new")
    facts: Mapped[list[Any]] = mapped_column(JSON, default=list)
    likely_causes: Mapped[list[Any]] = mapped_column(JSON, default=list)
    next_step: Mapped[str] = mapped_column(Text, default="")
    limitations: Mapped[list[Any]] = mapped_column(JSON, default=list)
    evidence_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    suggested_actions: Mapped[list[Any]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)
    session: Mapped[DiagnosticSession] = relationship(back_populates="findings")


class ConversationTurn(Base):
    __tablename__ = "conversation_turns"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(String, index=True)
    role: Mapped[str] = mapped_column(String)  # user | jarvis
    text: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    provider: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)


class AuditEvent(Base):
    """Append-only record of what JARVIS did (scans, exports, AI calls); no secrets."""

    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(default=now, index=True)
    kind: Mapped[str] = mapped_column(String)
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class ActionProposal(Base):
    """A proposed change (spec §12.4). Approval binds to tool version + argument hash + expiry."""

    __tablename__ = "action_proposals"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    tool_id: Mapped[str] = mapped_column(String, index=True)
    tool_version: Mapped[str] = mapped_column(String)
    risk_class: Mapped[str] = mapped_column(String)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    argument_hash: Mapped[str] = mapped_column(String)
    reason: Mapped[str] = mapped_column(Text, default="")
    source_finding_ids: Mapped[list[Any]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String, index=True)
    decision: Mapped[str] = mapped_column(String)  # auto_allowed | approval_required | denied
    approval_copy: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    verification: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    rollback_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(default=now, index=True)
    expires_at: Mapped[datetime] = mapped_column()
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)


class Memory(Base):
    """Long-term memory (spec §13.3): off by default, every fact approved by the user."""

    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | saved
    source: Mapped[str] = mapped_column(String, default="user")
    created_at: Mapped[datetime] = mapped_column(default=now)
    updated_at: Mapped[datetime] = mapped_column(default=now)


class Preference(Base):
    __tablename__ = "preferences"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text)


Index("ix_findings_session_severity", Finding.session_id, Finding.severity)

_engine = None
_session_factory: sessionmaker[Session] | None = None
_lock = threading.Lock()


def init_db(url: str | None = None) -> None:
    """Create the engine and tables. `url` is for tests (in-memory or temp file)."""
    global _engine, _session_factory
    with _lock:
        _engine = create_engine(url or f"sqlite:///{settings.db_path}", connect_args={"check_same_thread": False, "timeout": 5})

        @event.listens_for(_engine, "connect")
        def _pragmas(conn, _record):  # noqa: ANN001
            cur = conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=5000")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()

        Base.metadata.create_all(_engine)
        with _engine.begin() as conn:
            _migrate(conn)
            conn.execute(text(f"PRAGMA user_version={SCHEMA_VERSION}"))
        _session_factory = sessionmaker(_engine, expire_on_commit=False)


def _migrate(conn) -> None:  # noqa: ANN001
    """Additive schema steps for databases created by older versions (create_all adds new tables only)."""
    version = conn.execute(text("PRAGMA user_version")).scalar() or 0
    if version < 2:
        cols = {row[1] for row in conn.execute(text("PRAGMA table_info(findings)"))}
        if "suggested_actions" not in cols:
            conn.execute(text("ALTER TABLE findings ADD COLUMN suggested_actions JSON DEFAULT '[]'"))


@contextmanager
def session() -> Iterator[Session]:
    if _session_factory is None:
        init_db()
    assert _session_factory is not None
    s = _session_factory()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def audit(kind: str, summary: str, details: dict[str, Any] | None = None) -> None:
    with session() as s:
        s.add(AuditEvent(kind=kind, summary=summary, details=details or {}))


def get_pref(key: str, default: str) -> str:
    with session() as s:
        row = s.get(Preference, key)
        return row.value if row else default


def set_pref(key: str, value: str) -> None:
    with session() as s:
        row = s.get(Preference, key)
        if row:
            row.value = value
        else:
            s.add(Preference(key=key, value=value))


def purge_old(history_hours: int, keep_days: int = 180) -> None:
    """Retention: raw samples for `history_hours`; sessions, turns and audit for `keep_days`."""
    with session() as s:
        s.execute(MetricSample.__table__.delete().where(MetricSample.observed_at < now() - timedelta(hours=history_hours)))
        cutoff = now() - timedelta(days=keep_days)
        for old in s.scalars(select(DiagnosticSession).where(DiagnosticSession.created_at < cutoff)):
            s.delete(old)
        # Conversation history: 30 days (spec §13.3).
        s.execute(ConversationTurn.__table__.delete().where(ConversationTurn.created_at < now() - timedelta(days=30)))
        s.execute(AuditEvent.__table__.delete().where(AuditEvent.at < cutoff))


def dumps(value: Any) -> str:
    return json.dumps(value, default=str)
