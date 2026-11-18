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


# One fixed context size, so the model is never reloaded between questions. Even on the GPU the
# loaded model reserves about 2 GB of the PC's committed memory (measured on the 8 GB dev PC), so
# it is loaded when JARVIS is woken (warm), and freed on goodbye or after 2 idle minutes.
OPTIONS = {"temperature": 0.2, "num_ctx": 1024, "num_predict": 200}
KEEP_ALIVE = "2m"


def set_loaded(loaded: bool) -> None:
    """Load the model ahead of the first question, or free its memory now. Best effort, quick."""
    st = status()
    if st["runtime"] != "online" or not st["installed"]:
        return
    payload = {"model": model_name(), "prompt": "", "keep_alive": KEEP_ALIVE if loaded else 0, "options": OPTIONS}
    try:
        httpx.post(f"{settings.ollama_url}/api/generate", json=payload, timeout=60.0 if loaded else 5.0)
    except httpx.HTTPError:
        pass


def _payload(system: str, user: str, stream: bool, temperature: float | None = None) -> dict[str, Any]:
    return {
        "model": model_name(),
        "stream": stream,
        "keep_alive": KEEP_ALIVE,
        # Same context size always (no reload); only how adventurous the wording is changes.
        "options": OPTIONS if temperature is None else {**OPTIONS, "temperature": temperature},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }


def chat_stream(system: str, user: str, *, first_piece_timeout: float = 40.0, timeout: float = 120.0, temperature: float | None = None):
    """Yield the reply in pieces as the model writes it (spec §9.4 assistant.delta)."""
    import json

    try:
        # read= bounds the wait for each piece; the first one includes loading the model.
        with httpx.stream("POST", f"{settings.ollama_url}/api/chat", json=_payload(system, user, True, temperature), timeout=httpx.Timeout(timeout, connect=2.0, read=first_piece_timeout)) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                part = json.loads(line)
                piece = part.get("message", {}).get("content", "")
                if piece:
                    yield piece
                if part.get("done"):
                    return
    except (httpx.HTTPError, ValueError) as exc:
        raise ModelUnavailable(type(exc).__name__) from exc


def chat(system: str, user: str, *, timeout: float = 120.0) -> str:
    """One non-streaming chat turn. Small context and a short keep-alive keep RAM use low."""
    payload = _payload(system, user, False)
    try:
        r = httpx.post(f"{settings.ollama_url}/api/chat", json=payload, timeout=timeout)
        r.raise_for_status()
        return str(r.json().get("message", {}).get("content", "")).strip()
    except (httpx.HTTPError, ValueError) as exc:
        raise ModelUnavailable(type(exc).__name__) from exc
