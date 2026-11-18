"""Local model provider (spec §16: Ollama, loopback only). Optional dependency:
when Ollama is not running, callers get a clear MODEL_UNAVAILABLE and JARVIS
falls back to its deterministic explanation.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import settings
from ..storage import db


def model_name() -> str:
    return db.get_pref("model", settings.model)


_cache: tuple[float, dict[str, Any]] | None = None


def status(max_age: float = 20.0) -> dict[str, Any]:
    """Ollama runtime/model status, cached briefly so health checks stay fast."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < max_age:
        return _cache[1]
    want = model_name()
    try:
        # Loopback only; refused connections on Windows can stall, so keep the connect timeout short.
        r = httpx.get(f"{settings.ollama_url}/api/tags", timeout=httpx.Timeout(2.0, connect=0.5))
        r.raise_for_status()
        models = [m.get("name") for m in r.json().get("models", [])]
        installed = any(m == want or m.split(":")[0] == want for m in models)
        result = {"runtime": "online", "model": want, "installed": installed, "models": models}
    except (httpx.HTTPError, ValueError):
        result = {"runtime": "offline", "model": want, "installed": False, "models": []}
    _cache = (time.monotonic(), result)
    return result


class ModelUnavailable(RuntimeError):
    pass


def chat(system: str, user: str, *, timeout: float = 120.0) -> str:
    """One non-streaming chat turn. Small context and a short keep-alive keep RAM use low."""
    payload = {
        "model": model_name(),
        "stream": False,
        "keep_alive": "3m",  # unload soon after: this PC has 8 GB of RAM
        "options": {"temperature": 0.2, "num_ctx": 3072, "num_predict": 320},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    try:
        r = httpx.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=timeout)
        r.raise_for_status()
        return str(r.json().get("message", {}).get("content", "")).strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise ModelUnavailable(type(exc).__name__) from exc
