"""System telemetry from psutil (spec §16: psutil, BSD-3-Clause).

Every function returns plain data plus what it could not measure, so callers
can show "not available" instead of inventing values.
"""

from __future__ import annotations

import os
import platform
import time
from datetime import UTC, datetime
from typing import Any

import psutil

GB = 1024**3


def os_info() -> dict[str, Any]:
    boot = datetime.fromtimestamp(psutil.boot_time(), UTC)
    return {
        "system": platform.system(),
        "release": platform.release(),
        "version": platform.version(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "logical_cpus": psutil.cpu_count(logical=True),
        "physical_cpus": psutil.cpu_count(logical=False),
        "boot_time": boot.isoformat().replace("+00:00", "Z"),
        "uptime_hours": round((time.time() - psutil.boot_time()) / 3600, 1),
    }


def memory() -> dict[str, Any]:
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    return {
        "total_bytes": vm.total,
        "available_bytes": vm.available,
        "used_percent": vm.percent,
        "available_percent": round(vm.available / vm.total * 100, 1),
        "swap_total_bytes": sw.total,
        "swap_used_percent": sw.percent,
    }


def cpu(interval: float = 0.5) -> dict[str, Any]:
    data: dict[str, Any] = {"percent": psutil.cpu_percent(interval=interval)}
    freq = psutil.cpu_freq()
    if freq:
        data["current_mhz"] = round(freq.current)
        data["max_mhz"] = round(freq.max) if freq.max else None
    return data


def volumes() -> list[dict[str, Any]]:
    system_drive = (os.environ.get("SystemDrive") or "C:").upper()
    out = []
    for part in psutil.disk_partitions(all=False):
        if "cdrom" in part.opts or not part.fstype:
            continue
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        out.append(
            {
                "mount": part.mountpoint,
                "fstype": part.fstype,
                "is_system": part.mountpoint.upper().startswith(system_drive),
                "total_bytes": usage.total,
                "free_bytes": usage.free,
                "free_percent": round(100 - usage.percent, 1),
            }
        )
    return out


def network_interfaces() -> list[dict[str, Any]]:
    stats = psutil.net_if_stats()
    out = []
    for name, st in stats.items():
        if name.lower().startswith(("loopback", "lo")):
            continue
        out.append({"name": name, "is_up": st.isup, "speed_mbps": st.speed or None})
    return out


def top_processes(limit: int = 10, cpu_window: float = 1.0) -> list[dict[str, Any]]:
    """Top processes by CPU over a short window, plus memory. Names only; no command lines."""
    procs = []
    for p in psutil.process_iter(["pid", "name"]):
        try:
            p.cpu_percent(None)
            procs.append(p)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    time.sleep(cpu_window)
    cores = psutil.cpu_count(logical=True) or 1
    rows = []
    for p in procs:
        try:
            with p.oneshot():
                rows.append(
                    {
                        "pid": p.pid,
                        "name": p.info.get("name") or "?",
                        "cpu_percent": round(p.cpu_percent(None) / cores, 1),
                        "memory_bytes": p.memory_info().rss,
                    }
                )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    rows = [r for r in rows if r["pid"] not in (0, 4)]  # System Idle / System
    by_cpu = sorted(rows, key=lambda r: r["cpu_percent"], reverse=True)[:limit]
    by_mem = sorted(rows, key=lambda r: r["memory_bytes"], reverse=True)[:limit]
    return _merge(by_cpu, by_mem)


def _merge(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen, out = set(), []
    for row in a + b:
        if row["pid"] not in seen:
            seen.add(row["pid"])
            out.append(row)
    return out


def process_list(limit: int = 100) -> list[dict[str, Any]]:
    """All processes by memory (cheap: no CPU window). CPU comes from the sampler."""
    rows = []
    for p in psutil.process_iter(["pid", "name", "memory_info", "username"]):
        try:
            info = p.info
            mem = info.get("memory_info")
            rows.append({"pid": info["pid"], "name": info.get("name") or "?", "memory_bytes": mem.rss if mem else 0})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return sorted(rows, key=lambda r: r["memory_bytes"], reverse=True)[:limit]
