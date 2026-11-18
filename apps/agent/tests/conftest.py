import os
import tempfile

# Isolated data dir and token before the package loads its settings.
_tmp = tempfile.mkdtemp(prefix="jarvis-test-")
os.environ["JARVIS_AGENT_DATA"] = _tmp
os.environ["JARVIS_AGENT_TOKEN"] = "test-token"
os.environ["JARVIS_OLLAMA_URL"] = "http://127.0.0.1:9"  # nothing listens here: model offline

from jarvis.storage import db  # noqa: E402

db.init_db(f"sqlite:///{_tmp}/test.db")
