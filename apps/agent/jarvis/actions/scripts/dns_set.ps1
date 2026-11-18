<#
JARVIS admin action: set one adapter's IPv4 DNS servers. Runs elevated through the
Windows UAC prompt that the user answers. Arguments are validated by the agent
before this script is started; this script validates them again.
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^[\w .()#*\-]{1,64}$')][string]$Alias,
    [ValidatePattern('^[0-9a-fA-F.:,]*$')][string]$Servers = '',
    [switch]$Reset
)
$ErrorActionPreference = 'Stop'
$adapter = Get-NetAdapter -Name $Alias
if ($Reset) {
    Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ResetServerAddresses
} else {
    $list = @($Servers -split ',' | Where-Object { $_ })
    foreach ($s in $list) { [void][System.Net.IPAddress]::Parse($s) }
    Set-DnsClientServerAddress -InterfaceIndex $adapter.ifIndex -ServerAddresses $list
}
Clear-DnsClientCache
exit 0
