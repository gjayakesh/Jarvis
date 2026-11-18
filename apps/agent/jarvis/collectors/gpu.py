"""GPU telemetry from NVIDIA's own nvidia-smi (installed with the driver, signed by NVIDIA).

Read-only, fixed arguments, no admin. Gives temperature, load, VRAM and the
card's own thermal limits, so thermal rules compare against the vendor's
threshold for that sensor instead of a generic number (spec §11.1).
Other GPU vendors report "unsupported" rather than guessed values.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import time
from typing import Any

_NO_WINDOW = 0x08000000
_FIELDS = "name,temperature.gpu,utilization.gpu,memory.used,memory.total,clocks_throttle_reasons.hw_thermal_slowdown,clocks_throttle_reasons.sw_thermal_slowdown,power.draw"
_cache: tuple[float, dict[str, Any]] | None = None


def _num(v: str) -> float | None:
    try:
        return float(v)
    except ValueError:
        return None


def _limits(exe: str) -> dict[str, float]:
    proc = subprocess.run([exe, "-q", "-d", "TEMPERATURE"], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
    text = proc.stdout.decode("utf-8", errors="replace")
    out = {}
    for key, label in (("slowdown_c", "GPU Slowdown Temp"), ("shutdown_c", "GPU Shutdown Temp"), ("target_c", "GPU Target Temperature Specification")):
        m = re.search(re.escape(label) + r"\s*:\s*(\d+)", text)
        if m:
            out[key] = float(m.group(1))
    return out


def read(max_age: float = 5.0) -> dict[str, Any]:
    """One snapshot (cached for `max_age` seconds so the Monitor screen stays cheap)."""
    global _cache
    if _cache and time.monotonic() - _cache[0] < max_age:
        return _cache[1]
    exe = shutil.which("nvidia-smi")
    if not exe:
        result: dict[str, Any] = {"supported": False, "reason": "No NVIDIA GPU tools found; other GPUs are not read yet."}
    else:
        try:
            proc = subprocess.run([exe, f"--query-gpu={_FIELDS}", "--format=csv,noheader,nounits"], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
            row = [c.strip() for c in proc.stdout.decode("utf-8", errors="replace").splitlines()[0].split(",")]
            result = {
                "supported": True,
                "source": "nvidia-smi",
                "name": row[0],
                "temperature_c": _num(row[1]),
                "utilization_percent": _num(row[2]),
                "memory_used_mb": _num(row[3]),
                "memory_total_mb": _num(row[4]),
                "hw_thermal_slowdown": row[5] == "Active",
                "sw_thermal_slowdown": row[6] == "Active",
                "power_w": _num(row[7]),
                **_limits(exe),
            }
        except (subprocess.SubprocessError, OSError, IndexError) as exc:
            result = {"supported": False, "reason": f"nvidia-smi failed ({type(exc).__name__})."}
    _cache = (time.monotonic(), result)
    return result
