from fastapi.testclient import TestClient

from jarvis.api.app import app
from jarvis.assistant import answer
from jarvis.security.redaction import redact, redact_text

client = TestClient(app)
AUTH = {"Authorization": "Bearer test-token"}


def test_token_is_required():
    assert client.get("/api/v1/health").status_code == 401
    assert client.get("/api/v1/health", headers={"Authorization": "Bearer nope"}).status_code == 401
    r = client.get("/api/v1/health", headers=AUTH)
    assert r.status_code == 200 and r.headers["x-request-id"]


def test_cross_origin_and_wrong_host_rejected():
    assert client.get("/api/v1/health", headers={**AUTH, "Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/v1/health", headers={**AUTH, "Host": "evil.example"}).status_code == 421


def test_errors_have_code_and_request_id_without_trace():
    r = client.get("/api/v1/findings/fnd_missing", headers=AUTH)
    body = r.json()
    assert r.status_code == 404 and body["code"] == "NOT_FOUND" and body["request_id"]
    assert "Traceback" not in r.text
    bad = client.post("/api/v1/diagnostics/sessions", headers=AUTH, json={"profile": "rm -rf"})
    assert bad.status_code == 422 and bad.json()["code"] == "VALIDATION_ERROR"


def test_redaction():
    text = r"Failed in C:\Users\alice\AppData\x.exe from 192.168.1.20, mac 00-1A-2B-3C-4D-5E, mail a@b.com, SerialNumber: ABC123"
    out = redact_text(text)
    for secret in ("alice", "192.168.1.20", "00-1A-2B-3C-4D-5E", "a@b.com", "ABC123"):
        assert secret not in out
    assert redact({"serial_number": "X1", "nested": [{"hostname": "PC-1"}]}) == {"serial_number": "<redacted>", "nested": [{"hostname": "<redacted>"}]}


def test_assistant_answers_without_model_and_cites_evidence():
    r = client.post("/api/v1/assistant/turns", headers=AUTH, json={"text": "Why is my PC slow?"})
    body = r.json()
    assert r.status_code == 200 and body["provider"] == "rules"
    assert body["answer"] and body["facts"] and all(f.get("evidence_id") for f in body["facts"])
    assert any("Ollama" in lim for lim in body["limitations"])


def test_model_output_with_commands_is_never_passed_on():
    assert answer.FORBIDDEN.search("Run this: ```powershell Stop-Service x```")
    assert answer.FORBIDDEN.search("open cmd.exe and type taskkill /f")
    assert not answer.FORBIDDEN.search("Close a few browser tabs to free memory.")


def test_question_classification():
    assert "slow_pc" in answer.classify("why is my laptop so laggy")
    assert "network" in answer.classify("my wifi keeps dropping")
    assert answer.classify("hello there") == ["general"]
