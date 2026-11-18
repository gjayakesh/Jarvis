<#
Sign JARVIS's PowerShell scripts (spec §13.1: sign installers and scripts).

Needs a real code-signing certificate in your user certificate store, for example
from Azure Trusted Signing, Certum (open-source developer certificate) or another CA.
A self-signed certificate is NOT trusted by Smart App Control or SmartScreen.

  powershell -ExecutionPolicy Bypass -File tools\build\sign.ps1            # pick the only code-signing cert
  powershell -ExecutionPolicy Bypass -File tools\build\sign.ps1 -Thumbprint <sha1>

Every signature is time-stamped so it stays valid after the certificate expires.
#>
param(
    [string]$Thumbprint,
    [string]$TimestampServer = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$certs = @(Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.NotAfter -gt (Get-Date) })
if ($Thumbprint) { $certs = @($certs | Where-Object Thumbprint -eq $Thumbprint) }
if ($certs.Count -eq 0) { throw 'No valid code-signing certificate found in Cert:\CurrentUser\My. See the notes at the top of this script.' }
if ($certs.Count -gt 1) { throw "Several code-signing certificates found; pass -Thumbprint. Candidates: $($certs.Thumbprint -join ', ')" }
$cert = $certs[0]
if ($cert.Subject -eq $cert.Issuer) { Write-Warning 'This certificate is self-signed: Windows will not trust the signatures.' }

$files = Get-ChildItem -Path $root -Recurse -Include *.ps1 -File |
    Where-Object { $_.FullName -notmatch '\\(node_modules|\.venv|dist)\\' }
foreach ($f in $files) {
    $r = Set-AuthenticodeSignature -FilePath $f.FullName -Certificate $cert -TimestampServer $TimestampServer -HashAlgorithm SHA256
    '{0,-12} {1}' -f $r.Status, $f.FullName.Substring($root.Length + 1)
}
