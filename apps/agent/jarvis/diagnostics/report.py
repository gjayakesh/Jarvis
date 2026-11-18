"""Redacted diagnostic export (spec FR export: JSON / HTML, redacted by default)."""

from __future__ import annotations

import html
import json
from typing import Any

from sqlalchemy import select

from ..config import settings
from ..security.redaction import REDACTION_VERSION, redact
from ..storage import db


def build(session_id: str) -> dict[str, Any] | None:
    with db.session() as s:
        row = s.get(db.DiagnosticSession, session_id)
        if not row:
            return None
        findings = s.scalars(select(db.Finding).where(db.Finding.session_id == session_id)).all()
        evidence = s.scalars(select(db.EvidenceItem).where(db.EvidenceItem.session_id == session_id)).all()
        report = {
            "report_version": "1",
            "redaction_version": REDACTION_VERSION,
            "generated_at": db.iso(db.now()),
            "session": {"id": row.id, "profile": row.profile, "status": row.status, "created_at": db.iso(row.created_at), "finished_at": db.iso(row.finished_at), "summary": row.summary},
            "findings": [
                {
                    "rule_id": f.rule_id, "rule_version": f.rule_version, "title": f.title, "statement": f.statement, "severity": f.severity,
                    "confidence": f.confidence, "facts": f.facts, "likely_causes": f.likely_causes, "next_step": f.next_step,
                    "limitations": f.limitations, "evidence_ids": f.evidence_ids,
                }
                for f in findings
            ],
            "evidence": [
                {"evidence_id": e.id, "collector_id": e.collector_id, "evidence_type": e.evidence_type, "source": e.source, "observed_at": db.iso(e.observed_at), "quality": e.quality, "data": (e.data or {}).get("value"), "limitations": e.limitations}
                for e in evidence
            ],
        }
    # Stored evidence is already redacted at ingestion; redact again in case of older rows.
    return redact(report)


def export(session_id: str, fmt: str = "json") -> dict[str, Any] | None:
    report = build(session_id)
    if report is None:
        return None
    if fmt == "html":
        content = to_html(report)
        path = settings.export_dir / f"jarvis-report-{session_id}.html"
    else:
        content = json.dumps(report, indent=2)
        path = settings.export_dir / f"jarvis-report-{session_id}.json"
    path.write_text(content, encoding="utf-8")
    db.audit("export.created", f"Redacted {fmt.upper()} report saved", {"session_id": session_id, "format": fmt})
    return {"path": str(path), "format": fmt, "bytes": len(content.encode("utf-8")), "content": content}


SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def to_html(report: dict[str, Any]) -> str:
    e = html.escape
    rows = []
    for f in sorted(report["findings"], key=lambda f: SEVERITY_ORDER.get(f["severity"], 9)):
        facts = "".join(f"<li>{e(str(x['label']))}: <b>{e(str(x['value']))}</b> <small>({e(x['source'])}, {e(x['observed_at'] or '')})</small></li>" for x in f["facts"])
        causes = "".join(f"<li>{e(c['name'])} <small>({c['confidence']:.0%})</small></li>" for c in f["likely_causes"])
        rows.append(
            f"<section><h2>[{e(f['severity'].upper())}] {e(f['title'])}</h2><p>{e(f['statement'])}</p>"
            f"<h3>Evidence</h3><ul>{facts}</ul><h3>Possible causes</h3><ul>{causes}</ul>"
            f"<p><b>Next step:</b> {e(f['next_step'])}</p><p><small>{e(f['rule_id'])} v{e(f['rule_version'])} · confidence {f['confidence']:.0%}</small></p></section>"
        )
    sess = report["session"]
    body = "".join(rows) or "<p>No problems were found by the rules that could run.</p>"
    missing = "".join(f"<li>{e(k)}: {e(v)}</li>" for k, v in (sess.get("summary", {}).get("rules_not_available") or {}).items())
    return (
        "<!doctype html><html lang='en'><meta charset='utf-8'><title>JARVIS diagnostic report</title>"
        "<style>body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#111}"
        "section{border-top:1px solid #ccc;padding:12px 0}h2{font-size:18px}h3{font-size:14px;margin-bottom:4px}small{color:#555}</style>"
        f"<h1>JARVIS diagnostic report</h1><p>{e(sess['profile'])} scan · {e(sess['created_at'] or '')} · personal details redacted (v{e(report['redaction_version'])})</p>"
        f"{body}<h2>Not checked in this version</h2><ul>{missing}</ul></html>"
    )
