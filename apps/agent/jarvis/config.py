"""Runtime settings, read once at start-up from the environment the host provides."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _data_dir() -> Path:
    base = os.environ.get("JARVIS_AGENT_DATA") or os.path.join(os.environ.get("LOCALAPPDATA", "."), "JARVIS", "agent")
    path = Path(base)
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Settings:
    port: int = int(os.environ.get("JARVIS_AGENT_PORT", "47812"))
    # Per-launch secret from the host; never written to disk by the agent.
    token: str = os.environ.get("JARVIS_AGENT_TOKEN", "")
    data_dir: Path = field(default_factory=_data_dir)
    # Background sampling is deliberately slow: JARVIS must stay light on an 8 GB PC.
    sample_seconds: float = float(os.environ.get("JARVIS_SAMPLE_SECONDS", "10"))
    process_seconds: float = float(os.environ.get("JARVIS_PROCESS_SECONDS", "30"))
    history_hours: int = 24
    ollama_url: str = os.environ.get("JARVIS_OLLAMA_URL", "http://127.0.0.1:11434")
    model: str = os.environ.get("JARVIS_MODEL", "qwen2.5:1.5b")

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.db"

    @property
    def export_dir(self) -> Path:
        path = self.data_dir / "exports"
        path.mkdir(parents=True, exist_ok=True)
        return path


settings = Settings()
