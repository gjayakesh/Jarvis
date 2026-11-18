# Stops JARVIS and removes it from sign-in and the Start menu.
# Your voice data stays in %LOCALAPPDATA%\JARVIS unless you pass -RemoveData.
param([switch]$RemoveData)
$ErrorActionPreference = 'Continue'
$data = Join-Path $env:LOCALAPPDATA 'JARVIS'

# Ask a running host to quit cleanly.
$stateFile = Join-Path $data 'host.json'
if (Test-Path $stateFile) {
  try {
    $state = Get-Content $stateFile -Raw | ConvertFrom-Json
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($state.port)/host/quit" -Headers @{ 'x-jarvis-token' = $state.token } -Body '{}' -ContentType 'application/json' -TimeoutSec 5 | Out-Null
    Write-Host 'Stopped the running JARVIS.'
  } catch { Write-Host 'JARVIS was not running.' }
}

foreach ($lnk in (Join-Path ([Environment]::GetFolderPath('Startup')) 'JARVIS.lnk'), (Join-Path ([Environment]::GetFolderPath('Programs')) 'JARVIS.lnk')) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Removed: $lnk" }
}

if ($RemoveData -and (Test-Path $data)) {
  Start-Sleep -Seconds 2
  Remove-Item $data -Recurse -Force
  Write-Host "Removed data folder: $data"
}
