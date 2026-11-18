"""Tool registry (spec §12.2–12.3).

Risk class, version, argument schema, preconditions, side effects, approval copy,
rollback and postconditions are fixed here in source code. A language model can
only *name* a tool; it can never classify one or raise its permissions. Every
executor runs a fixed program with validated, typed arguments: no shell, no text
concatenated into a command line from user or model input.
"""

from __future__ import annotations

import datetime as _dt
import os
import struct
import subprocess
import winreg
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal

import psutil
from pydantic import BaseModel, ConfigDict, Field

from ..collectors import network
from ..config import settings

_NO_WINDOW = 0x08000000


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class NoArgs(Strict):
    pass


class StartupArgs(Strict):
    name: str = Field(min_length=1, max_length=120)


class PowerArgs(Strict):
    mode: Literal["restart", "shutdown"] = "restart"
    delay_seconds: int = Field(60, ge=60, le=600)


# Services JARVIS may restart (the D-SVC-01 catalogue). Anything else is refused.
RESTARTABLE_SERVICES = ("Dnscache", "Dhcp", "Audiosrv", "AudioEndpointBuilder", "Spooler", "bthserv", "WlanSvc", "Schedule", "CryptSvc", "LanmanWorkstation")


DNS_PRESETS = {
    "automatic": [],
    "cloudflare": ["1.1.1.1", "1.0.0.1"],
    "google": ["8.8.8.8", "8.8.4.4"],
    "quad9": ["9.9.9.9", "149.112.112.112"],
}


class DnsArgs(Strict):
    interface: str = Field(pattern=r"^[\w .()#*\-]{1,64}$")
    servers: Literal["automatic", "cloudflare", "google", "quad9"]


class ServiceArgs(Strict):
    name: Literal["Dnscache", "Dhcp", "Audiosrv", "AudioEndpointBuilder", "Spooler", "bthserv", "WlanSvc", "Schedule", "CryptSvc", "LanmanWorkstation"]


@dataclass
class Outcome:
    ok: bool
    summary: str
    details: dict[str, Any] = field(default_factory=dict)
    rollback_state: dict[str, Any] = field(default_factory=dict)


@dataclass
class Tool:
    tool_id: str
    version: str
    risk_class: str  # R0 | R1 | R2 | R3
    title: str
    description: str
    args: type[Strict]
    side_effects: str
    undo: str
    approval: Callable[[dict[str, Any]], str]
    available: bool = True
    unavailable_reason: str = ""
    needs_elevation: bool = False
    background: bool = False  # long-running: the action returns EXECUTING and finishes on its own
    precondition: Callable[[dict[str, Any]], str | None] | None = None  # returns a reason it cannot run
    execute: Callable[[dict[str, Any]], Outcome] | None = None
    verify: Callable[[dict[str, Any], Outcome], dict[str, Any]] | None = None
    rollback: Callable[[dict[str, Any], dict[str, Any]], Outcome] | None = None

    def describe(self) -> dict[str, Any]:
        return {
            "tool_id": self.tool_id,
            "version": self.version,
            "risk_class": self.risk_class,
            "title": self.title,
            "description": self.description,
            "input_schema": self.args.model_json_schema(),
            "side_effects": self.side_effects,
            "undo": self.undo,
            "available": self.available,
            "unavailable_reason": self.unavailable_reason,
            "needs_elevation": self.needs_elevation,
            "requires_approval": self.risk_class != "R0",
        }


def _run(cmd: list[str], timeout: float = 30) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=_NO_WINDOW)


# ---- network.flush_dns_cache (R1) ------------------------------------------------------


def _run_elevated(program: str, arguments: list[str], timeout: float = 180) -> tuple[int | None, str]:
    """Run one fixed program through Windows' administrator prompt (UAC); the user answers it.

    `program` and `arguments` come only from this module (enums and constants), never from
    user or model text. Returns (exit code, error text); exit None means the prompt was declined.
    """
    # Start-Process joins ArgumentList into one command line: quote each value. Values are
    # constants or strictly validated (no quotes possible), so quoting cannot be broken out of.
    for a in arguments:
        if '"' in a or "\n" in a:
            raise ValueError("unsafe argument")
    arg_list = ",".join("'" + ('"' + a + '"' if " " in a else a).replace("'", "''") + "'" for a in arguments)
    script = (
        f"$p = Start-Process -FilePath '{program}' -ArgumentList @({arg_list}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; "
        "exit $p.ExitCode"
    )
    try:
        proc = _run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script], timeout=timeout)
    except subprocess.TimeoutExpired:
        return 1, "timed out"
    err = proc.stderr.decode("utf-8", errors="replace")
    if "canceled by the user" in err.lower() or "cancelled by the user" in err.lower():
        return None, "declined"
    return proc.returncode, err.strip()[:200]


def _flush_dns(_args: dict[str, Any]) -> Outcome:
    # Windows 11 requires administrator rights for this, so Windows asks the user.
    code, _err = _run_elevated("ipconfig.exe", ["/flushdns"])
    if code is None:
        return Outcome(False, "You declined the Windows administrator prompt, so nothing was changed.")
    ok = code == 0
    return Outcome(ok, "DNS resolver cache cleared." if ok else "Windows could not clear the DNS cache.", {"exit_code": code})


def _verify_dns(_args: dict[str, Any], _o: Outcome) -> dict[str, Any]:
    checks = network.dns_checks()
    ok = all(c.get("ok") for c in checks)
    return {"verified": ok, "summary": "Web names resolve normally after the refresh." if ok else "Some web names still do not resolve.", "evidence": checks}


# ---- jarvis.clear_owned_cache (R1) ---------------------------------------------------------


def _owned_files() -> list[Path]:
    return [p for p in settings.export_dir.glob("jarvis-report-*") if p.suffix in (".json", ".html") and p.is_file()]


def _clear_cache(_args: dict[str, Any]) -> Outcome:
    files = _owned_files()
    freed = 0
    for p in files:
        freed += p.stat().st_size
        p.unlink(missing_ok=True)
    return Outcome(True, f"Removed {len(files)} report file(s) JARVIS made ({freed // 1024} KB).", {"files": len(files), "bytes": freed})


def _verify_cache(_args: dict[str, Any], _o: Outcome) -> dict[str, Any]:
    left = len(_owned_files())
    return {"verified": left == 0, "summary": "No JARVIS report files remain." if left == 0 else f"{left} file(s) could not be removed."}


# ---- startup.disable_entry (R2): per-user entries, same switch as Task Manager -------------

RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
APPROVED_RUN = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
APPROVED_FOLDER = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder"


def _startup_folder() -> Path:
    return Path(os.environ.get("APPDATA", "")) / r"Microsoft\Windows\Start Menu\Programs\Startup"


def user_startup_entries() -> list[dict[str, Any]]:
    """Per-user startup items JARVIS can switch off without admin, with their state."""
    entries = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as k:
            i = 0
            while True:
                try:
                    name, _value, _t = winreg.EnumValue(k, i)
                except OSError:
                    break
                entries.append({"name": name, "kind": "run", "enabled": _approved_state(APPROVED_RUN, name)})
                i += 1
    except OSError:
        pass
    folder = _startup_folder()
    if folder.is_dir():
        for f in folder.iterdir():
            if f.suffix.lower() in (".lnk", ".exe", ".bat", ".cmd", ".url"):
                entries.append({"name": f.name, "kind": "folder", "enabled": _approved_state(APPROVED_FOLDER, f.name)})
    return entries


def _approved_state(key: str, name: str) -> bool:
    raw = _read_approved(key, name)
    return raw is None or raw[0] in (0x02, 0x06)


def _read_approved(key: str, name: str) -> bytes | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key) as k:
            value, _t = winreg.QueryValueEx(k, name)
            return bytes(value)
    except OSError:
        return None


def _filetime_now() -> bytes:
    ticks = int((_dt.datetime.now(_dt.UTC) - _dt.datetime(1601, 1, 1, tzinfo=_dt.UTC)).total_seconds() * 10_000_000)
    return struct.pack("<Q", ticks)


def _find_entry(name: str) -> dict[str, Any] | None:
    return next((e for e in user_startup_entries() if e["name"] == name), None)


def _startup_pre(args: dict[str, Any]) -> str | None:
    entry = _find_entry(args["name"])
    if not entry:
        return "That startup item is not a per-user entry JARVIS can switch (it may need admin, or no longer exists)."
    if not entry["enabled"]:
        return "That startup item is already turned off."
    return None


def _startup_key(entry: dict[str, Any]) -> str:
    return APPROVED_RUN if entry["kind"] == "run" else APPROVED_FOLDER


def _disable_startup(args: dict[str, Any]) -> Outcome:
    entry = _find_entry(args["name"])
    if not entry:
        return Outcome(False, "Startup item not found.")
    key = _startup_key(entry)
    previous = _read_approved(key, entry["name"])
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, entry["name"], 0, winreg.REG_BINARY, b"\x03\x00\x00\x00" + _filetime_now())
    return Outcome(
        True,
        f"{entry['name']} will no longer start with Windows. The program itself was not changed or removed.",
        {"name": entry["name"]},
        {"key": key, "name": entry["name"], "previous": previous.hex() if previous else None},
    )


def _verify_startup(args: dict[str, Any], _o: Outcome) -> dict[str, Any]:
    entry = _find_entry(args["name"])
    ok = bool(entry) and not entry["enabled"]
    return {"verified": ok, "summary": "Windows now lists it as disabled at startup." if ok else "Windows still lists it as enabled."}


def _rollback_startup(_args: dict[str, Any], state: dict[str, Any]) -> Outcome:
    key, name, previous = state.get("key"), state.get("name"), state.get("previous")
    if key not in (APPROVED_RUN, APPROVED_FOLDER) or not name:
        return Outcome(False, "Nothing to restore.")
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
        if previous:
            winreg.SetValueEx(k, name, 0, winreg.REG_BINARY, bytes.fromhex(previous))
        else:
            try:
                winreg.DeleteValue(k, name)
            except OSError:
                pass
    ok = _approved_state(key, name)
    return Outcome(ok, f"{name} will start with Windows again." if ok else "Could not restore the startup item.")


# ---- power.shutdown_restart (R2) ------------------------------------------------------------


def _power(args: dict[str, Any]) -> Outcome:
    flag = "/r" if args["mode"] == "restart" else "/s"
    note = "JARVIS: you approved this. Say 'Hey Jarvis, cancel the restart' or run shutdown /a to cancel."
    proc = _run(["shutdown.exe", flag, "/t", str(int(args["delay_seconds"])), "/c", note])
    ok = proc.returncode == 0
    verb = "restart" if args["mode"] == "restart" else "shut down"
    return Outcome(ok, f"The PC will {verb} in {args['delay_seconds']} seconds. Save your work." if ok else f"Windows refused to schedule the {verb}.", {"exit_code": proc.returncode})


def _verify_power(_args: dict[str, Any], o: Outcome) -> dict[str, Any]:
    return {"verified": o.ok, "summary": "Scheduled by Windows; you can still cancel it." if o.ok else "Not scheduled."}


def _cancel_power(_args: dict[str, Any], _state: dict[str, Any]) -> Outcome:
    proc = _run(["shutdown.exe", "/a"])
    return Outcome(proc.returncode == 0, "The scheduled restart or shutdown was cancelled." if proc.returncode == 0 else "There was nothing to cancel.")


# ---- service.restart_named (R2, Windows asks for admin consent) -------------------------------


def _service_pre(args: dict[str, Any]) -> str | None:
    try:
        psutil.win_service_get(args["name"])
    except psutil.NoSuchProcess:
        return "That service does not exist on this PC."
    return None


def _restart_service(args: dict[str, Any]) -> Outcome:
    name = args["name"]  # one of RESTARTABLE_SERVICES, enforced by the schema
    code, _err = _run_elevated("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", f"Restart-Service -Name '{name}' -Force -ErrorAction Stop"])
    if code is None:
        return Outcome(False, "You declined the Windows administrator prompt, so nothing was changed.")
    return Outcome(code == 0, f"Windows restarted the {name} service." if code == 0 else f"Restarting {name} failed.", {"exit_code": code})


def _verify_service(args: dict[str, Any], _o: Outcome) -> dict[str, Any]:
    try:
        st = psutil.win_service_get(args["name"]).status()
    except psutil.NoSuchProcess:
        st = "missing"
    return {"verified": st == "running", "summary": f"The service is {st}."}


# ---- network.change_dns (R2, Windows asks for admin consent) -----------------------------------

SCRIPTS = Path(__file__).with_name("scripts")


def _ps_json(script: str) -> Any:
    proc = _run(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script + " | ConvertTo-Json -Compress -Depth 4"], timeout=30)
    import json

    text = proc.stdout.decode("utf-8", errors="replace").strip()
    return json.loads(text) if text else None


def _dns_state(alias: str) -> dict[str, Any]:
    """Current IPv4 DNS servers of one adapter and whether they are set by hand (not DHCP)."""
    quoted = alias.replace("'", "''")
    data = _ps_json(
        f"$a = Get-NetAdapter -Name '{quoted}' -ErrorAction Stop; "
        f"$d = Get-DnsClientServerAddress -InterfaceIndex $a.ifIndex -AddressFamily IPv4; "
        "$k = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\' + $a.InterfaceGuid; "
        "$static = (Get-ItemProperty -Path $k -Name NameServer -ErrorAction SilentlyContinue).NameServer; "
        "[ordered]@{ servers = @($d.ServerAddresses); static = [bool]$static; status = [string]$a.Status }"
    ) or {}
    servers = data.get("servers") or []
    return {"servers": servers if isinstance(servers, list) else [servers], "static": bool(data.get("static")), "status": data.get("status")}


def _dns_pre(args: dict[str, Any]) -> str | None:
    up = {n for n, st in psutil.net_if_stats().items() if st.isup}
    if args["interface"] not in up:
        return "That network adapter is not connected."
    want = DNS_PRESETS[args["servers"]]
    state = _dns_state(args["interface"])
    if (want and state["servers"][: len(want)] == want) or (not want and not state["static"]):
        return "That adapter already uses these DNS servers."
    return None


def _set_dns(alias: str, servers: list[str]) -> tuple[int | None, str]:
    script = str(SCRIPTS / "dns_set.ps1")
    extra = ["-Reset"] if not servers else ["-Servers", ",".join(servers)]
    return _run_elevated("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Alias", alias, *extra])


def _change_dns(args: dict[str, Any]) -> Outcome:
    alias, want = args["interface"], DNS_PRESETS[args["servers"]]
    before = _dns_state(alias)
    code, _err = _set_dns(alias, want)
    if code is None:
        return Outcome(False, "You declined the Windows administrator prompt, so nothing was changed.")
    label = "automatic (from your router)" if not want else f"{args['servers'].capitalize()} ({', '.join(want)})"
    return Outcome(code == 0, f"{alias} now uses {label} DNS." if code == 0 else "Windows could not change the DNS servers.", {"exit_code": code},
                   {"interface": alias, "servers": before["servers"] if before["static"] else []})


def _verify_dns_change(args: dict[str, Any], _o: Outcome) -> dict[str, Any]:
    want = DNS_PRESETS[args["servers"]]
    state = _dns_state(args["interface"])
    applied = (state["servers"][: len(want)] == want) if want else not state["static"]
    checks = network.dns_checks()
    ok = applied and all(c.get("ok") for c in checks)
    return {"verified": ok, "summary": ("The new servers are in place and web names resolve." if ok else "The setting or name lookups did not check out."), "evidence": checks}


def _rollback_dns(_args: dict[str, Any], state: dict[str, Any]) -> Outcome:
    alias = state.get("interface")
    if not alias:
        return Outcome(False, "Nothing to restore.")
    code, _err = _set_dns(alias, [s for s in state.get("servers", []) if s])
    if code is None:
        return Outcome(False, "You declined the Windows administrator prompt; the DNS setting was not restored.")
    return Outcome(code == 0, "The previous DNS setting is back." if code == 0 else "Could not restore the previous DNS setting.")


# ---- windows.run_sfc_dism (R2, background, Windows asks for admin consent) ------------------------


def _sfc(_args: dict[str, Any]) -> Outcome:
    import json

    result_path = settings.data_dir / f"sfc-result-{int(_dt.datetime.now().timestamp())}.json"
    code, _err = _run_elevated(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS / "sfc_repair.ps1"), "-ResultPath", str(result_path)],
        timeout=3 * 3600,
    )
    if code is None:
        return Outcome(False, "You declined the Windows administrator prompt, so no check ran.")
    if not result_path.exists():
        return Outcome(False, "The system file check did not report a result.")
    data = json.loads(result_path.read_text(encoding="utf-8-sig"))
    result_path.unlink(missing_ok=True)
    final = (data.get("sfc_after") or data.get("sfc") or {}).get("verdict", "unknown")
    from ..storage import db

    db.set_pref("last_sfc", json.dumps({**data, "final": final}))
    words = {
        "clean": "Windows checked its system files and found no problems.",
        "repaired": "Windows found damaged system files and repaired them. Restart when convenient.",
        "unrepaired": "Windows found damaged system files it could not repair, even after DISM.",
        "failed": "The system file check could not run (often fixed by a restart, then running it again).",
    }
    return Outcome(final in ("clean", "repaired"), words.get(final, "The check finished without a clear result."), {"sfc": data.get("sfc"), "dism": data.get("dism"), "final": final})


def _verify_sfc(_args: dict[str, Any], o: Outcome) -> dict[str, Any]:
    final = o.details.get("final")
    return {"verified": final in ("clean", "repaired"), "summary": f"System File Checker result: {final}."}


# ---- driver.open_optional_updates (R0): signed drivers come from Windows Update --------------------


def _open_driver_updates(_args: dict[str, Any]) -> Outcome:
    _run(["explorer.exe", "ms-settings:windowsupdate-optionalupdates"])
    return Outcome(True, "Opened Windows Update > Optional updates. Drivers there are signed and checked by Microsoft; install the ones you want.")


# ---- registry ------------------------------------------------------------------------------------

TOOLS: dict[str, Tool] = {
    t.tool_id: t
    for t in [
        Tool(
            "network.flush_dns_cache", "1.0.0", "R1", "Refresh the DNS cache",
            "Clears Windows' list of remembered web addresses so they are looked up fresh.", NoArgs,
            side_effects="Windows DNS client cache (temporary, rebuilt automatically).", undo="Not needed: the cache refills by itself.",
            approval=lambda a: "Clear the DNS resolver cache, then check that web names resolve. Windows will show an administrator prompt.",
            needs_elevation=True, execute=_flush_dns, verify=_verify_dns,
        ),
        Tool(
            "jarvis.clear_owned_cache", "1.0.0", "R1", "Delete JARVIS report files",
            "Removes report files JARVIS exported. Nothing else is touched.", NoArgs,
            side_effects="Only files named jarvis-report-* in JARVIS's own folder.", undo="Export the report again from Diagnostics.",
            approval=lambda a: f"Delete {len(_owned_files())} report file(s) that JARVIS created.",
            execute=_clear_cache, verify=_verify_cache,
        ),
        Tool(
            "startup.disable_entry", "1.0.0", "R2", "Stop an app starting with Windows",
            "Turns off one of your startup items, like Task Manager's Startup tab. The app is not removed.", StartupArgs,
            side_effects="One value under your user's StartupApproved registry key.", undo="Undo from Activity & safety turns it back on.",
            approval=lambda a: f"Stop “{a['name']}” from starting when you sign in. You can turn it back on at any time.",
            precondition=_startup_pre, execute=_disable_startup, verify=_verify_startup, rollback=_rollback_startup,
        ),
        Tool(
            "power.shutdown_restart", "1.0.0", "R2", "Restart or shut down",
            "Schedules a restart or shutdown with a countdown you can cancel.", PowerArgs,
            side_effects="Closes all apps when the countdown ends; unsaved work is lost.", undo="Cancel before the countdown ends.",
            approval=lambda a: f"{'Restart' if a['mode'] == 'restart' else 'Shut down'} the PC in {a['delay_seconds']} seconds. Save your work first.",
            execute=_power, verify=_verify_power, rollback=_cancel_power,
        ),
        Tool(
            "service.restart_named", "1.0.0", "R2", "Restart a Windows service",
            "Restarts one service from a fixed list. Windows asks you for administrator permission.", ServiceArgs,
            side_effects="Stops and starts the named service; features using it pause for a few seconds.", undo="Not needed: the service returns to running.",
            approval=lambda a: f"Restart the {a['name']} service. Windows will show an administrator prompt.",
            needs_elevation=True, precondition=_service_pre, execute=_restart_service, verify=_verify_service,
        ),
        Tool(
            "network.change_dns", "1.0.0", "R2", "Change DNS servers",
            "Switches one connected adapter between automatic DNS and a well-known public resolver.", DnsArgs,
            side_effects="IPv4 DNS servers of that one adapter; the DNS cache is cleared.", undo="Undo restores the previous servers.",
            approval=lambda a: f"Set {a['interface']} to {'automatic DNS from your router' if a['servers'] == 'automatic' else a['servers'].capitalize() + ' DNS (' + ', '.join(DNS_PRESETS[a['servers']]) + ')'}. Windows will show an administrator prompt.",
            needs_elevation=True, precondition=_dns_pre, execute=_change_dns, verify=_verify_dns_change, rollback=_rollback_dns,
        ),
        Tool(
            "windows.run_sfc_dism", "1.0.0", "R2", "Check and repair system files",
            "Runs System File Checker; if it cannot fix everything, repairs Windows' component store with DISM and checks again.", NoArgs,
            side_effects="Only Windows system files that SFC/DISM find damaged. Takes 10-30 minutes; DISM may download repair files from Windows Update.",
            undo="Not available (repairs restore Microsoft's original files).",
            approval=lambda a: "Check Windows system files and repair any damage. This runs in the background for 10-30 minutes. Windows will show an administrator prompt.",
            needs_elevation=True, background=True, execute=_sfc, verify=_verify_sfc,
        ),
        Tool(
            "driver.open_optional_updates", "1.0.0", "R0", "Find driver updates",
            "Opens Windows Update's optional driver updates, which only offers signed drivers checked by Microsoft.", NoArgs,
            side_effects="Opens a Settings page; nothing is installed until you click Install there.", undo="Not needed.",
            approval=lambda a: "Open Windows Update > Optional updates to review driver updates.",
            execute=_open_driver_updates,
        ),
        Tool("driver.install_package", "1.0.0", "R3", "Install a driver package", "Installs a downloaded vendor driver package.", NoArgs,
             side_effects="Drivers.", undo="Roll back in Device Manager.", approval=lambda a: "", available=False,
             unavailable_reason="High impact: JARVIS will not install downloaded driver packages. Use Find driver updates (Windows Update) or the PC maker's app."),
        Tool("firmware.update_guide", "1.0.0", "R3", "Firmware / BIOS update", "Manufacturer-directed guidance only.", NoArgs,
             side_effects="Firmware.", undo="Not available.", approval=lambda a: "", available=False, unavailable_reason="Never automated: follow the PC maker's instructions."),
    ]
}
