# Creates the JARVIS agent's Python environment (apps\agent\.venv).
# Run once, or again after changing dependencies:
#   powershell -ExecutionPolicy Bypass -File apps\agent\setup-agent.ps1
#
# Smart App Control blocks SQLAlchemy's optional compiled speed-ups on this PC,
# so SQLAlchemy is installed as pure Python (it is fast enough for JARVIS).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$py = (Get-Command py -ErrorAction SilentlyContinue)
if ($py) { & py -3.12 -m venv .venv } else { & python -m venv .venv }
$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

& $venvPy -m pip install --quiet --disable-pip-version-check --upgrade pip
& $venvPy -m pip install --quiet --disable-pip-version-check -e '.[dev]'

$env:DISABLE_SQLALCHEMY_CEXT = '1'
$version = & $venvPy -c "import importlib.metadata as m; print(m.version('sqlalchemy'))"
& $venvPy -m pip install --quiet --disable-pip-version-check --force-reinstall --no-deps --no-binary sqlalchemy "sqlalchemy==$version"

& $venvPy -c "import fastapi, uvicorn, psutil, sqlalchemy, pydantic, httpx; from sqlalchemy import create_engine, text; create_engine('sqlite://').connect().execute(text('select 1')); print('JARVIS agent environment ready')"
