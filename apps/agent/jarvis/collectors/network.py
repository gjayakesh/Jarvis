"""Network probes (spec FR network, D-NET-01..04): gateway reachability and loss,
DNS resolution and HTTPS reachability, each tested independently.

Probes send no personal data: ICMP echo to the default gateway, name lookups of
public names, and an HTTPS GET of public connectivity-check URLs.
"""

from __future__ import annotations

import concurrent.futures
import ipaddress
import re
import socket
import subprocess
import time
from typing import Any

import httpx

DNS_NAMES = ("www.microsoft.com", "one.one.one.one")
HTTPS_TARGETS = ("https://www.msftconnecttest.com/connecttest.txt", "https://cloudflare.com/cdn-cgi/trace")
_CREATE_NO_WINDOW = 0x08000000


def ping(host: str, count: int = 10, timeout_ms: int = 1000) -> dict[str, Any]:
    """ICMP echo via Windows ping.exe, fixed arguments; `host` must be an IP address."""
    ipaddress.ip_address(host)  # refuse anything that is not an IP literal
    cmd = ["ping.exe", "-n", str(int(count)), "-w", str(int(timeout_ms)), host]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=count * (timeout_ms / 1000 + 1.2) + 5, creationflags=_CREATE_NO_WINDOW)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {"sent": count, "received": 0, "loss_percent": 100.0, "error": type(exc).__name__}
    out = proc.stdout.decode("utf-8", errors="replace")
    replies = len(re.findall(r"(?i)time[=<]\s*\d+\s*ms", out))
    rtts = [int(x) for x in re.findall(r"(?i)time[=<]\s*(\d+)\s*ms", out)]
    return {
        "sent": count,
        "received": replies,
        "loss_percent": round((count - replies) / count * 100, 1),
        "avg_ms": round(sum(rtts) / len(rtts), 1) if rtts else None,
    }


def _resolve(name: str) -> dict[str, Any]:
    t0 = time.perf_counter()
    try:
        infos = socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)
        return {"name": name, "ok": bool(infos), "ms": round((time.perf_counter() - t0) * 1000)}
    except OSError as exc:
        return {"name": name, "ok": False, "error": type(exc).__name__, "ms": round((time.perf_counter() - t0) * 1000)}


def dns_checks(timeout: float = 5.0) -> list[dict[str, Any]]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(DNS_NAMES)) as pool:
        futures = {pool.submit(_resolve, n): n for n in DNS_NAMES}
        out = []
        for fut, name in futures.items():
            try:
                out.append(fut.result(timeout=timeout))
            except concurrent.futures.TimeoutError:
                out.append({"name": name, "ok": False, "error": "timeout"})
        return out


def https_checks(timeout: float = 6.0) -> list[dict[str, Any]]:
    out = []
    with httpx.Client(timeout=timeout, follow_redirects=False, headers={"User-Agent": "connectivity-check"}) as client:
        for url in HTTPS_TARGETS:
            t0 = time.perf_counter()
            try:
                r = client.get(url)
                out.append({"url": url, "ok": r.status_code < 500, "status": r.status_code, "ms": round((time.perf_counter() - t0) * 1000)})
            except httpx.HTTPError as exc:
                out.append({"url": url, "ok": False, "error": type(exc).__name__})
    return out
