# Sets JARVIS up to run in the background from Windows sign-in.
#  - builds the UI (apps/desktop/dist)
#  - adds "JARVIS" to your Startup folder (starts hidden, listening)
#  - adds "JARVIS" to the Start menu (opens the window)
# Nothing is installed system-wide and no security setting is changed.
# Undo with uninstall-startup.ps1.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$app = Split-Path -Parent $here

Write-Host 'Building the JARVIS interface...'
Push-Location $app
# cmd keeps the build's informational stderr output from stopping Windows PowerShell.
try { cmd /c 'pnpm build 2>&1' | Out-Host; if ($LASTEXITCODE -ne 0) { throw 'Build failed' } } finally { Pop-Location }

$ps = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$start = Join-Path $here 'start-jarvis.ps1'
$shell = New-Object -ComObject WScript.Shell

function New-JarvisShortcut([string]$path, [string]$arguments, [string]$description) {
  $lnk = $shell.CreateShortcut($path)
  $lnk.TargetPath = $ps
  $lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$start`" $arguments"
  $lnk.WorkingDirectory = $here
  $lnk.WindowStyle = 7  # minimized: no console flash
  $lnk.Description = $description
  $lnk.Save()
}

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'JARVIS.lnk'
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'JARVIS.lnk'
New-JarvisShortcut $startup '-Background' 'Start JARVIS in the background at sign-in'
New-JarvisShortcut $menu '' 'Open JARVIS'
Write-Host "Added: $startup"
Write-Host "Added: $menu"

Write-Host 'Starting JARVIS now...'
& $ps -NoProfile -ExecutionPolicy Bypass -File $start
Write-Host 'Done. The first time, allow the microphone in the JARVIS window, then set up your voice.'
