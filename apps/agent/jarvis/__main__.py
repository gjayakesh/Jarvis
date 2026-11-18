"""Start the agent: `python -m jarvis` (the background host does this).

Environment: JARVIS_AGENT_TOKEN (required), JARVIS_AGENT_PORT (default 47812),
JARVIS_AGENT_DATA (default %LOCALAPPDATA%\\JARVIS\\agent).
"""

from __future__ import annotations

import os
import sys
import threading
import time

import psutil
import uvicorn

from .api.app import app
from .collectors.sampler import sampler
from .config import settings
from .storage import db


def _exit_with_host() -> None:
    """Stop when the host that started us is gone, so no agent is ever left running alone."""
    host_pid = int(os.environ.get("JARVIS_HOST_PID", "0") or 0)
    if not host_pid:
        return

    def watch() -> None:
        while True:
            time.sleep(5)
            if not psutil.pid_exists(host_pid):
                os._exit(0)

    threading.Thread(target=watch, name="jarvis-host-watch", daemon=True).start()


def main() -> int:
    if not settings.token:
        print("JARVIS_AGENT_TOKEN is required", file=sys.stderr)
        return 2
    _exit_with_host()
    db.init_db()
    db.audit("agent.started", "JARVIS agent started")
    sampler.start()
    # Loopback only (spec §9): never 0.0.0.0. One worker, no reload, quiet access log.
    uvicorn.run(app, host="127.0.0.1", port=settings.port, log_level="warning", access_log=False, workers=1)
    sampler.stop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
