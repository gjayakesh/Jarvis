"""Redaction of personal and identifying values (spec FR exports, §8.4, §13).

Applied at ingestion for free-text evidence (event messages, paths) and again
for every export. Structured numbers are left alone.
"""

from __future__ import annotations

import os
import re
import socket
from typing import Any

REDACTION_VERSION = "1"

_IPV4 = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_IPV6 = re.compile(r"\b(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{1,4}\b")
_MAC = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
_EMAIL = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")
_USER_PATH = re.compile(r"(?i)([a-z]:\\users\\)([^\\/\s\"']+)")
_GUIDISH_SERIAL = re.compile(r"(?i)\b(serial(?:number)?\s*[:=]\s*)(\S+)")

# Keys whose values identify the machine or person, wherever they appear in structured data.
SENSITIVE_KEYS = {"serial", "serialnumber", "serial_number", "macaddress", "mac", "mac_address", "username", "user", "hostname", "computername", "uuid"}


def _identity_terms() -> list[str]:
    terms = {os.environ.get("USERNAME", ""), os.environ.get("COMPUTERNAME", ""), socket.gethostname()}
    return sorted((t for t in terms if t and len(t) >= 3), key=len, reverse=True)


def redact_text(text: str) -> str:
    if not text:
        return text
    out = _USER_PATH.sub(r"\1<user>", text)
    out = _EMAIL.sub("<email>", out)
    out = _MAC.sub("<mac>", out)
    out = _IPV6.sub("<ip>", out)
    out = _IPV4.sub("<ip>", out)
    out = _GUIDISH_SERIAL.sub(r"\1<serial>", out)
    for term in _identity_terms():
        out = re.sub(re.escape(term), "<redacted>", out, flags=re.IGNORECASE)
    return out


def redact(value: Any) -> Any:
    """Recursively redact strings and sensitive keys in JSON-like data."""
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [redact(v) for v in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if isinstance(key, str) and key.lower().replace("-", "_") in SENSITIVE_KEYS and item not in (None, ""):
                result[key] = "<redacted>"
            else:
                result[key] = redact(item)
        return result
    return value
