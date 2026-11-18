"""Normalized evidence (spec Appendix A) and the helpers rules use to cite it."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from ..security.redaction import redact
from ..storage.db import iso, new_id


@dataclass
class Evidence:
    collector_id: str
    evidence_type: str
    source: str
    data: Any
    quality: str = "valid"  # valid | partial | unsupported | error
    units: dict[str, str] = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)
    observed_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    id: str = field(default_factory=lambda: new_id("ev"))

    def __post_init__(self) -> None:
        # Sensitive values are redacted at ingestion (spec §8.1 step 6).
        self.data = redact(self.data)

    @property
    def usable(self) -> bool:
        return self.quality in ("valid", "partial")

    def fact(self, label: str, value: Any) -> dict[str, Any]:
        return {"label": label, "value": value, "source": self.source, "observed_at": iso(self.observed_at), "evidence_id": self.id}


def section(collector_id: str, evidence_type: str, source: str, raw: dict[str, Any] | None) -> Evidence:
    """Wrap one PowerShell probe section; errors become explicit 'error' evidence."""
    if not raw:
        return Evidence(collector_id, evidence_type, source, None, quality="unsupported", limitations=["Not collected"])
    if not raw.get("ok"):
        return Evidence(collector_id, evidence_type, source, None, quality="error", limitations=[str(raw.get("error") or "Failed")[:200]])
    return Evidence(collector_id, evidence_type, source, raw.get("data"))


def gb(n: float | int | None) -> str:
    """Human size: GB from 1 GB up, MB below (a 32 MB process is not "0.0 GB")."""
    if n is None:
        return "unknown"
    if n >= 1024**3:
        return f"{n / 1024**3:.1f} GB"
    return f"{n / 1024**2:.0f} MB"
