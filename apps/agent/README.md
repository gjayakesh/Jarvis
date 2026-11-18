# JARVIS agent

The local service behind JARVIS's PC features (spec §7–§13). It reads the PC,
runs the diagnostic rules, answers questions from the evidence, and carries out
a small set of approved fixes. It runs as the signed-in user, never as admin.

## Setup

```powershell
powershell -ExecutionPolicy Bypass -File apps\agent\setup-agent.ps1
```

This creates `apps\agent\.venv`. Smart App Control blocks SQLAlchemy's optional
compiled parts on this PC, so the script installs SQLAlchemy as pure Python.

The background host (`apps\desktop\host\jarvis-host.mjs`) starts the agent,
restarts it if it exits, and stops it when JARVIS quits. The agent also exits
on its own if the host disappears.

Local AI is optional: install [Ollama](https://ollama.com), then
`ollama pull qwen2.5:1.5b`. Without it, answers use JARVIS's own rule text.

## Security

- Listens on `127.0.0.1:47812` only. Every request needs the per-launch bearer
  token the host passes in `JARVIS_AGENT_TOKEN`; wrong Host headers and
  cross-origin browser requests are refused.
- The page never sees the agent token: it calls `/api/v1/*` on the host, which
  checks the host token and forwards the request.
- No endpoint runs arbitrary commands. Collectors run one fixed, read-only
  PowerShell script; tools run fixed programs with validated, typed arguments.
- Free text (event messages, paths) is redacted when stored, and again on export.

## What it does

| Area | Where |
|---|---|
| Live metrics (10 s samples, 24 h kept) and processes (30 s) | `collectors/sampler.py`, `collectors/system.py` |
| Windows evidence: events, devices, disks, security, services, battery, startup | `collectors/windows_probe.ps1` |
| Router, DNS and HTTPS probes | `collectors/network.py` |
| GPU temperature, load and VRAM (nvidia-smi), boot timing | `collectors/gpu.py`, `collectors/windows_probe.ps1` |
| 26 deterministic rules, 6 scan profiles | `diagnostics/rules.py`, `diagnostics/engine.py` |
| Redacted JSON/HTML reports | `diagnostics/report.py` |
| Evidence-grounded answers (Ollama optional), streamed over SSE | `assistant/answer.py` |
| Scan progress streamed over SSE | `api/app.py` (`/diagnostics/sessions/{id}/events`) |
| Long-term memory, off by default, user-approved | `assistant/memory.py` |
| Safe actions: registry, approval bound to argument hash, verify, undo | `actions/tools.py`, `actions/policy.py` |

### Tools

| Tool | Risk | Notes |
|---|---|---|
| `network.flush_dns_cache` | R1 | Windows admin prompt; verifies name lookups afterwards |
| `jarvis.clear_owned_cache` | R1 | Only `jarvis-report-*` files JARVIS wrote |
| `startup.disable_entry` | R2 | Per-user startup items, like Task Manager; Undo restores |
| `power.shutdown_restart` | R2 | 60–600 s countdown; Undo cancels |
| `service.restart_named` | R2 | Fixed service list; Windows shows its admin prompt |
| `network.change_dns` | R2 | Automatic / Cloudflare / Google / Quad9 only; admin prompt; Undo restores |
| `windows.run_sfc_dism` | R2 | SFC, then DISM + SFC if needed; admin prompt; runs in the background |
| `driver.open_optional_updates` | R0 | Opens Windows Update optional (signed) driver updates |
| `driver.install_package`, `firmware.update_guide` | R3 | Never automated |

R1 tools run automatically only if "Automatically apply safe fixes" is on, and never when
they need the Windows admin prompt. Everything else waits for the user to approve the exact
proposal shown. Admin actions do not use a resident elevated service: each one runs a fixed,
reviewed script from `actions/scripts/` through Windows' own UAC prompt, which the user answers.

### Not covered yet

- CPU temperatures (Windows only exposes them to administrators); the GPU sensor is read.
- Temperature baselines and personal metric baselines (D-THERM-02, D-ANOM-01) need weeks of history.
- Driver-change correlation (D-DRV-02) and USB disconnect history (D-USB-01).
- Schema changes use a small built-in migration step (`storage/db.py`), not Alembic.

## Tests

```powershell
apps\agent\.venv\Scripts\python.exe -m pytest apps\agent
```

One test switches a throwaway per-user startup entry off and on again in the
real registry, and always removes it afterwards.
