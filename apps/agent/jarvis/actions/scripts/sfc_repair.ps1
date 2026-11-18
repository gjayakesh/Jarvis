<#
JARVIS admin action: verify and repair Windows system files. Runs elevated through
the Windows UAC prompt that the user answers. Writes a small JSON result for the
agent to read; touches nothing but what SFC and DISM themselves repair.
#>
param([Parameter(Mandatory)][ValidatePattern('^[A-Za-z]:\\[\w\\ .\-]+\.json$')][string]$ResultPath)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::Unicode  # sfc writes UTF-16

function Sfc-Run {
    $text = (& "$env:SystemRoot\System32\sfc.exe" /scannow | Out-String)
    $verdict = 'unknown'
    if ($text -match 'did not find any integrity violations') { $verdict = 'clean' }
    elseif ($text -match 'found corrupt files and successfully repaired') { $verdict = 'repaired' }
    elseif ($text -match 'found corrupt files but was unable to fix') { $verdict = 'unrepaired' }
    elseif ($text -match 'could not perform the requested operation') { $verdict = 'failed' }
    [ordered]@{ verdict = $verdict; exit_code = $LASTEXITCODE }
}

$result = [ordered]@{ started = (Get-Date).ToUniversalTime().ToString('o') }
$result.sfc = Sfc-Run
if ($result.sfc.verdict -in 'unrepaired', 'failed') {
    # Repair the component store from Windows Update, then check the files again.
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    & "$env:SystemRoot\System32\Dism.exe" /Online /Cleanup-Image /RestoreHealth | Out-Null
    $result.dism = [ordered]@{ exit_code = $LASTEXITCODE; ok = ($LASTEXITCODE -eq 0) }
    [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
    $result.sfc_after = Sfc-Run
}
$result.finished = (Get-Date).ToUniversalTime().ToString('o')
$result | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ResultPath -Encoding UTF8
exit 0
