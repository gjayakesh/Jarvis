"""Software bill of materials and licence report (spec §13.1, WBS-091).

Writes SBOM/sbom.cdx.json (CycloneDX 1.5) and SBOM/LICENSES.md for everything
JARVIS ships: the agent's Python packages and the UI's production npm packages.
Copyleft and unknown licences are flagged for review (spec §16 caution).

Run with the agent's Python:  apps\\agent\\.venv\\Scripts\\python.exe tools\\build\\make-sbom.py
"""

from __future__ import annotations

import importlib.metadata as md
import json
import re
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "SBOM"
REVIEW = re.compile(r"(?i)\b(A?GPL|LGPL|MPL|EPL|CDDL|SSPL|CC-BY-NC|CC-BY-SA|unknown)\b")


def python_components() -> list[dict]:
    comps = []
    for dist in md.distributions():
        name = dist.metadata["Name"]
        if not name or name.lower() in ("pip", "setuptools", "wheel", "jarvis-agent"):
            continue
        lic = dist.metadata.get("License-Expression") or dist.metadata.get("License") or ""
        if not lic or len(lic) > 80:  # some packages put the whole licence text here
            classifiers = [c.split("::")[-1].strip() for c in dist.metadata.get_all("Classifier") or [] if c.startswith("License ::")]
            lic = ", ".join(classifiers) or ("see package" if lic else "unknown")
        comps.append({"ecosystem": "pypi", "name": name, "version": dist.version, "license": lic.strip()})
    return comps


def npm_components() -> list[dict]:
    desktop = ROOT / "apps" / "desktop"
    raw = subprocess.run("pnpm list --prod --depth Infinity --json", cwd=desktop, capture_output=True, shell=True, text=True, encoding="utf-8").stdout
    data = json.loads(raw or "[]")
    seen: dict[tuple[str, str], dict] = {}

    def walk(deps: dict) -> None:
        for name, info in (deps or {}).items():
            version = info.get("version", "")
            key = (name, version)
            if key in seen:
                continue
            path = info.get("path")
            if not path or not (Path(path) / "package.json").exists():
                continue  # optional platform build not installed on this PC: not shipped
            lic = "unknown"
            if True:
                pkg = json.loads((Path(path) / "package.json").read_text(encoding="utf-8"))
                lic = pkg.get("license") or (pkg.get("licenses") or [{}])[0].get("type") or "unknown"
                if isinstance(lic, dict):
                    lic = lic.get("type", "unknown")
            seen[key] = {"ecosystem": "npm", "name": name, "version": version, "license": str(lic)}
            walk(info.get("dependencies"))

    for project in data:
        walk(project.get("dependencies"))
    return list(seen.values())


def main() -> None:
    comps = sorted(python_components() + npm_components(), key=lambda c: (c["ecosystem"], c["name"].lower()))
    OUT.mkdir(exist_ok=True)
    purl = lambda c: f"pkg:{c['ecosystem']}/{c['name'].replace('@', '%40')}@{c['version']}"  # noqa: E731
    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {"timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"), "component": {"type": "application", "name": "JARVIS", "version": "0.2.0"}},
        "components": [
            {"type": "library", "name": c["name"], "version": c["version"], "purl": purl(c), "licenses": [{"license": {"name": c["license"]}}]}
            for c in comps
        ],
    }
    (OUT / "sbom.cdx.json").write_text(json.dumps(bom, indent=2), encoding="utf-8")
    flagged = [c for c in comps if REVIEW.search(c["license"])]
    notes = {
        "sharp": "Node-only image library pulled in by @huggingface/transformers; not part of the browser bundle JARVIS runs (dist/).",
        "@img/sharp-win32-x64": "Native part of sharp (libvips, LGPL-3.0); Node-only, not in the browser bundle.",
    }
    lines = [
        "# JARVIS licence report",
        "",
        f"Generated {datetime.now(UTC):%Y-%m-%d} by `tools/build/make-sbom.py`. {len(comps)} components "
        f"({sum(c['ecosystem'] == 'pypi' for c in comps)} Python, {sum(c['ecosystem'] == 'npm' for c in comps)} npm).",
        "",
        "## Needs review (copyleft or unknown licence)",
        "",
    ]
    lines += [f"- {c['ecosystem']} `{c['name']}` {c['version']}: {c['license']}" + (f" ({notes[c['name']]})" if c["name"] in notes else "") for c in flagged] or ["None."]
    lines += ["", "Separately licensed assets (not packages): voice models (MIT, see apps/desktop/scripts/fetch-models.mjs),", "Ollama and its models (installed separately; check the model's own licence).", "", "## All components", "", "| Ecosystem | Package | Version | Licence |", "|---|---|---|---|"]
    lines += [f"| {c['ecosystem']} | {c['name']} | {c['version']} | {c['license']} |" for c in comps]
    (OUT / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(comps)} components, {len(flagged)} to review -> {OUT}")


if __name__ == "__main__":
    main()
