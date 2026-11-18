"""Runs the read-only PowerShell probe and returns its sections.

Only `windows_probe.ps1` from this package is ever executed, with a fixed
argument list: no model output or user text reaches the command line.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

PROBE = Path(__file__).with_name("windows_probe.ps1")
ALL_SECTIONS = ("events", "devices", "disks", "adapters", "netconfig", "security", "services", "battery", "startup", "bluetooth", "audio")
_CREATE_NO_WINDOW = 0x08000000


def run_probe(sections: tuple[str, ...] = ALL_SECTIONS, event_hours: int = 24, timeout: float = 90.0) -> dict[str, Any]:
    wanted = [s for s in sections if s in ALL_SECTIONS]
    if not wanted:
        return {}
    cmd = [
        "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", str(PROBE), "-Sections", ",".join(wanted), "-EventHours", str(int(event_hours)),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=_CREATE_NO_WINDOW)
    except subprocess.TimeoutExpired:
        return {s: {"ok": False, "error": f"Timed out after {int(timeout)} s"} for s in wanted}
    except OSError as exc:
        return {s: {"ok": False, "error": f"PowerShell unavailable: {exc}"} for s in wanted}
    text = proc.stdout.decode("utf-8-sig", errors="replace").strip()
    try:
        data = json.loads(text) if text else {}
    except json.JSONDecodeError:
        err = proc.stderr.decode("utf-8", errors="replace").strip()[:300]
        return {s: {"ok": False, "error": f"Probe output unreadable: {err or 'empty'}"} for s in wanted}
    out = {s: data.get(s, {"ok": False, "error": "Section missing"}) for s in wanted}
    # PowerShell turns a one-item list into a bare object (and an empty one into null).
    for name in LIST_SECTIONS & set(wanted):
        sec = out[name]
        if sec.get("ok"):
            value = sec.get("data")
            if value is None or value == {}:
                sec["data"] = []  # an empty pipeline serializes as null or {}
            elif isinstance(value, dict):
                sec["data"] = [value]
    return out


LIST_SECTIONS = {"devices", "disks", "adapters", "netconfig", "services", "startup", "audio"}
