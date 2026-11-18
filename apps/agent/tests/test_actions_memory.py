"""G4 safe actions and G5 memory: approval binding, expiry, denial, rollback, secrets."""

import winreg
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from jarvis.actions import policy
from jarvis.actions.tools import APPROVED_RUN, RUN_KEY, TOOLS, NoArgs, Outcome, Tool
from jarvis.api.app import app
from jarvis.assistant import memory
from jarvis.storage import db

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}
calls = []


@pytest.fixture(autouse=True)
def fake_tools():
    """Harmless test tools so no test changes the PC (except the startup round-trip below)."""
    TOOLS["test.r1"] = Tool("test.r1", "1.0.0", "R1", "Test R1", "test", NoArgs, "none", "none", lambda a: "Do the R1 test",
                            execute=lambda a: (calls.append("r1"), Outcome(True, "done"))[1], verify=lambda a, o: {"verified": True, "summary": "ok"})
    TOOLS["test.r2"] = Tool("test.r2", "1.0.0", "R2", "Test R2", "test", NoArgs, "none", "undo it", lambda a: "Do the R2 test",
                            execute=lambda a: Outcome(True, "changed", rollback_state={"was": 1}), verify=lambda a, o: {"verified": True, "summary": "ok"},
                            rollback=lambda a, st: Outcome(st.get("was") == 1, "restored"))
    db.set_pref("auto_safe_fixes", "off")
    yield
    TOOLS.pop("test.r1", None)
    TOOLS.pop("test.r2", None)


def test_r2_requires_approval_bound_to_argument_hash():
    a = client.post("/api/v1/actions", headers=AUTH, json={"tool_id": "test.r2", "arguments": {}}).json()
    assert a["status"] == "AWAITING_APPROVAL" and a["argument_hash"].startswith("sha256:")
    r = client.post(f"/api/v1/actions/{a['action_id']}/execute", headers=AUTH)
    assert r.status_code == 409 and r.json()["code"] == "APPROVAL_REQUIRED"
    bad = client.post(f"/api/v1/actions/{a['action_id']}/approve", headers=AUTH, json={"argument_hash": "sha256:tampered"})
    assert bad.status_code == 412
    ok = client.post(f"/api/v1/actions/{a['action_id']}/approve", headers=AUTH, json={"argument_hash": a["argument_hash"]})
    assert ok.json()["status"] == "APPROVED"
    done = client.post(f"/api/v1/actions/{a['action_id']}/execute", headers=AUTH).json()
    assert done["status"] == "VERIFIED" and done["can_rollback"]
    again = client.post(f"/api/v1/actions/{a['action_id']}/execute", headers=AUTH).json()
    assert again["status"] == "VERIFIED"  # idempotent
    undone = client.post(f"/api/v1/actions/{a['action_id']}/rollback", headers=AUTH).json()
    assert undone["status"] == "ROLLED_BACK"


def test_expired_approval_is_refused():
    a = policy.propose("test.r2", {})
    with db.session() as s:
        s.get(db.ActionProposal, a["action_id"]).expires_at = db.now() - timedelta(seconds=1)
    r = client.post(f"/api/v1/actions/{a['action_id']}/approve", headers=AUTH, json={"argument_hash": a["argument_hash"]})
    assert r.status_code == 410 and r.json()["code"] == "APPROVAL_EXPIRED"


def test_r3_and_unavailable_tools_are_denied():
    for tool in ("firmware.update_guide", "network.change_dns"):
        a = client.post("/api/v1/actions", headers=AUTH, json={"tool_id": tool}).json()
        assert a["status"] == "DENIED"
        assert client.post(f"/api/v1/actions/{a['action_id']}/execute", headers=AUTH).status_code == 403


def test_auto_safe_only_covers_r1():
    assert policy.propose("test.r1", {})["status"] == "AWAITING_APPROVAL"
    db.set_pref("auto_safe_fixes", "on")
    r1 = policy.propose("test.r1", {})
    assert r1["status"] == "AUTO_AUTHORIZED"
    assert policy.execute(r1["action_id"])["status"] == "VERIFIED"
    assert policy.propose("test.r2", {})["status"] == "AWAITING_APPROVAL"


def test_arguments_are_strictly_validated():
    r = client.post("/api/v1/actions", headers=AUTH, json={"tool_id": "service.restart_named", "arguments": {"name": "WinDefend"}})
    assert r.status_code == 422
    r2 = client.post("/api/v1/actions", headers=AUTH, json={"tool_id": "power.shutdown_restart", "arguments": {"mode": "restart", "delay_seconds": 5}})
    assert r2.status_code == 422
    r3 = client.post("/api/v1/actions", headers=AUTH, json={"tool_id": "startup.disable_entry", "arguments": {"name": "x", "cmd": "calc"}})
    assert r3.status_code == 422


def test_startup_disable_and_undo_round_trip():
    """Real per-user startup switch on a throwaway entry that is always removed."""
    name = "JARVIS-test-entry"
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
        winreg.SetValueEx(k, name, 0, winreg.REG_SZ, r"C:\nonexistent\jarvis-test.exe")
    try:
        a = policy.propose("startup.disable_entry", {"name": name})
        policy.approve(a["action_id"], a["argument_hash"])
        done = policy.execute(a["action_id"])
        assert done["status"] == "VERIFIED", done
        back = policy.rollback(a["action_id"])
        assert back["status"] == "ROLLED_BACK"
    finally:
        for key in (RUN_KEY, APPROVED_RUN):
            try:
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_SET_VALUE) as k:
                    winreg.DeleteValue(k, name)
            except OSError:
                pass


def test_memory_off_by_default_and_refuses_secrets():
    db.set_pref("memory_enabled", "off")
    assert client.post("/api/v1/memories", headers=AUTH, json={"text": "I like dark mode"}).status_code == 403
    assert "off" in memory.handle_chat("remember that I work night shifts")
    db.set_pref("memory_enabled", "on")
    assert client.post("/api/v1/memories", headers=AUTH, json={"text": "my wifi password is hunter2"}).status_code == 422
    assert client.post("/api/v1/memories", headers=AUTH, json={"text": "card 4111 1111 1111 1111"}).status_code == 422
    saved = client.post("/api/v1/memories", headers=AUTH, json={"text": "I use the PC for video editing"}).json()
    assert saved["status"] == "saved"


def test_memory_from_chat_waits_for_approval():
    db.set_pref("memory_enabled", "on")
    reply = memory.handle_chat("Remember that I prefer short answers")
    assert "Approve" in reply
    pending = [m for m in memory.list_all() if m["text"] == "I prefer short answers"][0]
    assert pending["status"] == "pending" and "I prefer short answers" not in memory.saved_facts()
    client.patch(f"/api/v1/memories/{pending['memory_id']}", headers=AUTH, json={"approve": True})
    assert "I prefer short answers" in memory.saved_facts()
    assert "Settings" in memory.handle_chat("forget everything")  # never deletes from one sentence
    assert client.delete("/api/v1/memories", headers=AUTH).json()["deleted"] >= 1


def test_tools_needing_admin_prompt_are_never_automatic():
    db.set_pref("auto_safe_fixes", "on")
    assert TOOLS["network.flush_dns_cache"].needs_elevation
    assert policy.propose("network.flush_dns_cache", {})["status"] == "AWAITING_APPROVAL"
