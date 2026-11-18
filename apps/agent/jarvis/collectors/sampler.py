"""Background sampler: one light system sample every `sample_seconds`, a process
snapshot every `process_seconds`. Samples are persisted (bounded) for history and
kept in memory for the rules that need a recent window (CPU, memory, leaks, disk).
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import psutil

from ..config import settings
from ..storage import db


@dataclass
class Sample:
    at: datetime
    cpu: float
    mem_percent: float
    mem_available: float
    mem_available_percent: float
    disk_busy: float | None
    disk_read_bps: float | None
    disk_write_bps: float | None
    net_recv_bps: float | None
    net_sent_bps: float | None


@dataclass
class ProcessSnapshot:
    at: datetime
    # pid -> (name, cpu_percent_of_machine, rss_bytes, create_time)
    rows: dict[int, tuple[str, float, int, float]]


class Sampler:
    def __init__(self) -> None:
        self.samples: deque[Sample] = deque(maxlen=int(3600 / max(1, settings.sample_seconds)))  # last hour in memory
        self.processes: deque[ProcessSnapshot] = deque(maxlen=int(1800 / max(1, settings.process_seconds)))  # last 30 min
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_disk = None
        self._last_net = None
        self._last_t = 0.0
        self._proc_cpu: dict[int, float] = {}
        self._last_purge = 0.0
        self.lock = threading.Lock()

    def start(self) -> None:
        if self._thread:
            return
        psutil.cpu_percent(None)  # prime
        self._thread = threading.Thread(target=self._run, name="jarvis-sampler", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        next_proc = 0.0
        while not self._stop.is_set():
            started = time.monotonic()
            try:
                self._sample()
                if started >= next_proc:
                    self._sample_processes()
                    next_proc = started + settings.process_seconds
                if started - self._last_purge > 3600:
                    db.purge_old(settings.history_hours)
                    self._last_purge = started
            except Exception as exc:  # a failed sample must never stop the loop
                db.audit("sampler.error", f"Sample failed: {type(exc).__name__}")
            self._stop.wait(max(1.0, settings.sample_seconds - (time.monotonic() - started)))

    def _sample(self) -> None:
        t = time.monotonic()
        vm = psutil.virtual_memory()
        disk = psutil.disk_io_counters()
        net = psutil.net_io_counters()
        busy = rbps = wbps = recv = sent = None
        if self._last_t and disk and self._last_disk:
            dt = t - self._last_t
            rbps = max(0.0, (disk.read_bytes - self._last_disk.read_bytes) / dt)
            wbps = max(0.0, (disk.write_bytes - self._last_disk.write_bytes) / dt)
            # Windows reports read/write time in ms; their sum over the interval approximates active time.
            io_ms = (disk.read_time - self._last_disk.read_time) + (disk.write_time - self._last_disk.write_time)
            busy = max(0.0, min(100.0, io_ms / (dt * 1000) * 100))
        if self._last_t and net and self._last_net:
            dt = t - self._last_t
            recv = max(0.0, (net.bytes_recv - self._last_net.bytes_recv) / dt)
            sent = max(0.0, (net.bytes_sent - self._last_net.bytes_sent) / dt)
        self._last_disk, self._last_net, self._last_t = disk, net, t
        sample = Sample(
            at=datetime.now(UTC),
            cpu=psutil.cpu_percent(None),
            mem_percent=vm.percent,
            mem_available=float(vm.available),
            mem_available_percent=round(vm.available / vm.total * 100, 1),
            disk_busy=None if busy is None else round(busy, 1),
            disk_read_bps=rbps,
            disk_write_bps=wbps,
            net_recv_bps=recv,
            net_sent_bps=sent,
        )
        with self.lock:
            self.samples.append(sample)
        with db.session() as s:
            s.add(
                db.MetricSample(
                    observed_at=sample.at,
                    cpu_percent=sample.cpu,
                    memory_percent=sample.mem_percent,
                    memory_available=sample.mem_available,
                    disk_busy_percent=sample.disk_busy,
                    disk_read_bps=rbps,
                    disk_write_bps=wbps,
                    net_recv_bps=recv,
                    net_sent_bps=sent,
                )
            )

    def _sample_processes(self) -> None:
        cores = psutil.cpu_count(logical=True) or 1
        rows: dict[int, tuple[str, float, int, float]] = {}
        seen = set()
        for p in psutil.process_iter(["pid", "name", "memory_info", "create_time", "cpu_times"]):
            try:
                info = p.info
                pid = info["pid"]
                if pid in (0, 4):
                    continue
                seen.add(pid)
                times = info.get("cpu_times")
                total = (times.user + times.system) if times else 0.0
                prev = self._proc_cpu.get(pid)
                self._proc_cpu[pid] = total
                pct = 0.0
                if prev is not None:
                    pct = max(0.0, (total - prev) / settings.process_seconds / cores * 100)
                mem = info.get("memory_info")
                rows[pid] = (info.get("name") or "?", round(pct, 1), mem.rss if mem else 0, info.get("create_time") or 0.0)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        for gone in set(self._proc_cpu) - seen:
            self._proc_cpu.pop(gone, None)
        with self.lock:
            self.processes.append(ProcessSnapshot(at=datetime.now(UTC), rows=rows))

    # ---- views -----------------------------------------------------------------
    def recent(self, seconds: float) -> list[Sample]:
        cutoff = time.time() - seconds
        with self.lock:
            return [s for s in self.samples if s.at.timestamp() >= cutoff]

    def latest(self) -> Sample | None:
        with self.lock:
            return self.samples[-1] if self.samples else None

    def latest_processes(self, limit: int = 15) -> list[dict[str, Any]]:
        with self.lock:
            snap = self.processes[-1] if self.processes else None
        if not snap:
            return []
        rows = [{"pid": pid, "name": n, "cpu_percent": c, "memory_bytes": m} for pid, (n, c, m, _) in snap.rows.items()]
        by_cpu = sorted(rows, key=lambda r: r["cpu_percent"], reverse=True)[:limit]
        by_mem = sorted(rows, key=lambda r: r["memory_bytes"], reverse=True)[:limit]
        seen, out = set(), []
        for r in by_cpu + by_mem:
            if r["pid"] not in seen:
                seen.add(r["pid"])
                out.append(r)
        return out

    def process_history(self) -> list[ProcessSnapshot]:
        with self.lock:
            return list(self.processes)


sampler = Sampler()
