# Starts the JARVIS background host without a console window.
#   -Background : start hidden (used at Windows sign-in)
param([switch]$Background)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = Join-Path $env:ProgramFiles 'nodejs\node.exe' }
$nodeArgs = @("`"$(Join-Path $here 'jarvis-host.mjs')`"")
if ($Background) { $nodeArgs += '--background' }
Start-Process -FilePath $node -ArgumentList $nodeArgs -WindowStyle Hidden -WorkingDirectory $here
