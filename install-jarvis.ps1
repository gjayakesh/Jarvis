<#
JARVIS one-step install for the signed-in user (no administrator rights needed).

  powershell -ExecutionPolicy Bypass -File .\install-jarvis.ps1            # everything
  powershell -ExecutionPolicy Bypass -File .\install-jarvis.ps1 -NoAI      # skip Ollama

Steps, each skipped when already done:
  1. checks Node.js 20+, Python 3.12 and pnpm
  2. installs UI dependencies and downloads the on-device voice models
  3. creates the PC agent's Python environment (apps\agent\setup-agent.ps1)
  4. optionally installs Ollama (official winget package) and a small model
  5. builds the UI and adds JARVIS to Startup and the Start menu (install-startup.ps1)

Undo with apps\desktop\host\uninstall-startup.ps1 (and winget uninstall Ollama.Ollama).
Nothing is installed system-wide and no security setting is changed.
#>
param(
    [switch]$NoAI,
    [string]$Model = 'qwen2.5:1.5b'
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$desktop = Join-Path $root 'apps\desktop'

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Yellow }
function Need([string]$cmd, [string]$hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd is missing. $hint" }
}

Step 'Checking prerequisites'
Need node 'Install Node.js 20 or newer from nodejs.org (or: winget install OpenJS.NodeJS.LTS).'
$nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw "Node.js $nodeMajor is too old; JARVIS needs 20 or newer." }
if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Python 3.12 is missing. Install it from python.org (or: winget install Python.Python.3.12).'
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host 'Enabling pnpm through corepack...'
    corepack enable
}
Write-Host "Node $(node --version), pnpm $(pnpm --version)"

Step 'Installing interface dependencies'
Push-Location $desktop
try {
    cmd /c 'pnpm install --frozen-lockfile 2>&1' | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
    Step 'Downloading on-device voice models (first time only)'
    node scripts\fetch-models.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed' }
} finally { Pop-Location }

Step 'Setting up the PC agent'
& (Join-Path $root 'apps\agent\setup-agent.ps1')

if (-not $NoAI) {
    Step 'Local AI (Ollama)'
    $ollama = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollama -and (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe")) { $ollama = Get-Item "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
    if (-not $ollama) {
        Need winget 'Install "App Installer" from the Microsoft Store, or install Ollama from ollama.com.'
        winget install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
        $ollama = Get-Item "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
    }
    $exe = if ($ollama.Source) { $ollama.Source } else { $ollama.FullName }
    Write-Host "Downloading the $Model model (about 1 GB, first time only)..."
    & $exe pull $Model
}

Step 'Building JARVIS and adding it to Startup'
& (Join-Path $desktop 'host\install-startup.ps1')
