"""Rule fixtures: positive, negative and missing-data cases (spec §11.1)."""

from jarvis.diagnostics.evidence import Evidence
from jarvis.diagnostics.rules import Context, RULES, confidence

GB = 1024**3
BY_ID = {r.id: r for r in RULES}


def run(rule_id, **evidence):
    ctx = Context(evidence={k.replace("__", "."): v for k, v in evidence.items()})
    return BY_ID[rule_id].fn(ctx)


def ev(kind, data, quality="valid"):
    return Evidence("test", kind, "fixture", data, quality=quality)


def events(**parts):
    return ev("windows.events", {k: {"ok": True, "rows": v} for k, v in parts.items()})


def test_at_least_twenty_rules_registered():
    assert len(RULES) >= 20
    assert len({r.id for r in RULES}) == len(RULES)


def test_cpu_sustained_positive_and_negative():
    high = [{"age_s": i * 10, "cpu": 97} for i in range(7)]
    procs = ev("process.top", [{"name": "game.exe", "cpu_percent": 80, "memory_bytes": GB}])
    res = run("D-CPU-01", cpu__window=ev("cpu.window", high), process__top=procs)
    assert res and res.severity == "medium" and "game.exe" in str(res.facts)
    mixed = high[:5] + [{"age_s": 50, "cpu": 40}, {"age_s": 60, "cpu": 95}]
    assert run("D-CPU-01", cpu__window=ev("cpu.window", mixed), process__top=procs) is None


def test_cpu_needs_enough_samples():
    few = [{"age_s": 0, "cpu": 99}, {"age_s": 10, "cpu": 99}]
    assert run("D-CPU-01", cpu__window=ev("cpu.window", few)) is None


def test_memory_pressure_with_paging_is_high():
    win = [{"age_s": i * 10, "available_percent": 6} for i in range(12)]
    snap = ev("memory.snapshot", {"available_bytes": 0.5 * GB, "total_bytes": 8 * GB, "swap_used_percent": 91})
    res = run("D-MEM-01", memory__window=ev("memory.window", win), memory__snapshot=snap)
    assert res.severity == "high" and res.confidence > 0.8
    ok = [{"age_s": i * 10, "available_percent": 35} for i in range(12)]
    assert run("D-MEM-01", memory__window=ev("memory.window", ok), memory__snapshot=snap) is None


def test_low_disk_space_thresholds():
    vol = lambda free, total: ev("volume.list", [{"mount": "C:\\", "is_system": True, "free_bytes": free, "total_bytes": total, "free_percent": free / total * 100}])
    assert run("D-DISK-01", volume__list=vol(3 * GB, 256 * GB)).severity == "high"
    assert run("D-DISK-01", volume__list=vol(12 * GB, 256 * GB)).severity == "medium"
    assert run("D-DISK-01", volume__list=vol(80 * GB, 256 * GB)) is None


def test_errored_evidence_is_not_used():
    broken = Evidence("test", "windows.devices", "fixture", None, quality="error")
    assert run("D-DRV-01", windows__devices=broken) is None


def test_device_problem_code_and_disabled_devices():
    devs = ev("windows.devices", [{"name": "Wi-Fi adapter", "class": "Net", "problem_code": 43, "problem": "Device reported a problem and was stopped"}])
    res = run("D-DRV-01", windows__devices=devs)
    assert res.severity == "high" and "code 43" in str(res.facts)
    disabled = ev("windows.devices", [{"name": "Webcam", "class": "Camera", "problem_code": 22, "problem": "Device is disabled"}])
    assert run("D-DRV-01", windows__devices=disabled).severity == "info"


def test_update_loop_explains_store_app_open():
    rows = [{"time": "2026-11-12T07:00:00Z", "props": ["-2147009278", "9NKSQGP7F2NH-5319275A.WhatsAppDesktop"]}] * 3
    res = run("D-UPD-01", windows__events=events(update_failures=rows))
    assert res.severity == "low"
    assert "app was open" in res.statement and "0x80073D02" in str(res.facts)
    assert run("D-UPD-01", windows__events=events(update_failures=rows[:1])) is None


def test_unexpected_shutdown_is_info_alone():
    res = run("D-EVT-02", windows__events=events(power=[{"time": "t"}], dirty_shutdown=[], bugcheck=[], whea=[]))
    assert res.severity == "info"
    res2 = run("D-EVT-02", windows__events=events(power=[{"time": "t"}], dirty_shutdown=[], bugcheck=[{"time": "t"}], whea=[]))
    assert res2.severity == "medium"


def test_repeated_crash_groups_by_app():
    crash = {"props": ["photos.exe", "1.0", "gdi32.dll", "c0000005"]}
    res = run("D-EVT-01", windows__events=events(app_crashes=[crash] * 3))
    assert "photos.exe" in res.title
    assert run("D-EVT-01", windows__events=events(app_crashes=[crash] * 2)) is None


def test_defender_off_but_other_antivirus_is_fine():
    sec = lambda products, fw=True: ev("windows.security", {"defender": {"realtime": False}, "antivirus_products": products, "firewall": [{"profile": "Public", "enabled": fw}]})
    assert run("D-SEC-01", windows__security=sec([{"name": "Windows Defender"}])).severity == "high"
    assert run("D-SEC-01", windows__security=sec([{"name": "Windows Defender"}, {"name": "Other AV"}])) is None
    assert run("D-SEC-01", windows__security=sec([{"name": "Other AV"}], fw=False)) is not None


def test_network_rules_separate_router_dns_and_https():
    ping_ok = ev("net.gateway_ping", {"sent": 10, "received": 10, "loss_percent": 0, "avg_ms": 3})
    ping_dead = ev("net.gateway_ping", {"sent": 10, "received": 0, "loss_percent": 100})
    dns_bad = ev("net.dns", [{"name": "a", "ok": False}, {"name": "b", "ok": False}])
    dns_ok = ev("net.dns", [{"name": "a", "ok": True}, {"name": "b", "ok": True}])
    https_bad = ev("net.https", [{"url": "https://x/y", "ok": False, "error": "ConnectTimeout"}])
    assert run("D-NET-02", net__gateway_ping=ping_dead) is not None
    assert run("D-NET-02", net__gateway_ping=ping_ok) is None
    assert run("D-NET-01", net__dns=dns_bad, net__gateway_ping=ping_ok).severity == "medium"
    assert run("D-NET-04", net__https=https_bad, net__dns=dns_ok, net__gateway_ping=ping_ok) is not None
    assert run("D-NET-04", net__https=https_bad, net__dns=dns_bad, net__gateway_ping=ping_ok) is None


def test_battery_wear():
    b = lambda full: ev("windows.battery", {"present": True, "design_mwh": 50000, "full_mwh": full})
    assert run("D-BATT-01", windows__battery=b(30000)) is not None
    assert run("D-BATT-01", windows__battery=b(45000)) is None
    assert run("D-BATT-01", windows__battery=ev("windows.battery", {"present": False})) is None


def test_confidence_is_bounded_and_needs_samples():
    assert confidence(0.9, samples=1, needed=10) < confidence(0.9, samples=10, needed=10)
    assert 0.05 <= confidence(0.0) and confidence(1.0, corroborated=True) <= 0.97
