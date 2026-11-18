<#
JARVIS Windows probe: read-only evidence collection, JSON on stdout.

Runs as the signed-in user (no elevation). Every section is independent: a
failed or unsupported section reports {error} and never stops the others.
Nothing here changes system state.

Device errors, disk health, network adapters and the disk/storage event query
are adapted from PC-AI (https://github.com/David-Martel/PC-AI, MIT License,
Copyright (c) 2025 David Martel), Modules/PC-AI.Hardware/Public/*.ps1 at commit
ea92d044750b6c4c30f59b55621ae61c0f6175a9: their CIM fallback paths, without the
native Rust module.
#>
param(
    [string]$Sections = 'events,devices,disks,adapters,netconfig,security,services,battery,startup,bluetooth,audio',
    [int]$EventHours = 24
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$want = $Sections -split ','
$out = [ordered]@{ probe_version = '1'; collected_at = (Get-Date).ToUniversalTime().ToString('o') }

function Section([string]$name, [scriptblock]$body) {
    if ($want -notcontains $name) { return }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try { $data = & $body; $out[$name] = @{ ok = $true; data = $data; ms = $sw.ElapsedMilliseconds } }
    catch { $out[$name] = @{ ok = $false; error = $_.Exception.Message; ms = $sw.ElapsedMilliseconds } }
}

function Get-Events([hashtable]$filter, [int]$max = 200) {
    try { @(Get-WinEvent -FilterHashtable $filter -MaxEvents $max -ErrorAction Stop) }
    catch { if ($_.Exception.Message -match 'No events were found') { @() } else { throw } }
}

function Event-Row($ev, [int[]]$props = @()) {
    $p = @()
    foreach ($i in $props) { if ($ev.Properties.Count -gt $i) { $p += [string]$ev.Properties[$i].Value } else { $p += $null } }
    # Some providers ship no message resources on a given PC; the event still counts.
    $msg = $null
    try { $msg = (($ev.Message -split "`n")[0]).Trim() } catch { }
    [ordered]@{
        time = $ev.TimeCreated.ToUniversalTime().ToString('o'); id = $ev.Id; provider = $ev.ProviderName
        level = $ev.Level; props = $p; message = $msg
    }
}

# One event query; its failure is reported on its own and never hides the others.
function Event-Query([hashtable]$filter, [int]$max, [int[]]$props = @(), [scriptblock]$where = $null) {
    try {
        $events = Get-Events $filter $max
        if ($where) { $events = @($events | Where-Object $where) }
        [ordered]@{ ok = $true; rows = @($events | Select-Object -First 50 | ForEach-Object { Event-Row $_ $props }) }
    } catch { [ordered]@{ ok = $false; error = $_.Exception.Message; rows = @() } }
}

# Device Manager problem codes (Microsoft documented values).
$ProblemCodes = @{
    1 = 'Not configured correctly'; 3 = 'Driver may be corrupted or the system is low on memory'; 10 = 'Device cannot start'
    12 = 'Not enough free resources'; 14 = 'Needs a restart'; 18 = 'Drivers need reinstalling'; 19 = 'Registry configuration is damaged'
    21 = 'Windows is removing this device'; 22 = 'Device is disabled'; 24 = 'Device not present or not working'; 28 = 'Drivers not installed'
    29 = 'Disabled by firmware'; 31 = 'Windows cannot load the drivers'; 32 = 'Driver service is disabled'; 37 = 'Driver failed to initialise'
    38 = 'Previous driver instance still loaded'; 39 = 'Driver corrupted or missing'; 41 = 'Driver loaded but hardware not found'
    43 = 'Device reported a problem and was stopped'; 45 = 'Device not connected'; 48 = 'Driver blocked from starting'; 52 = 'Driver signature cannot be verified'
}

$hours = $EventHours
$since = (Get-Date).AddHours(-$hours)
$weekAgo = (Get-Date).AddDays(-7)

Section 'events' {
    [ordered]@{
        window_hours = $hours
        # D-EVT-01: application crashes and hangs (props: app, app version, module, exception code).
        app_crashes = Event-Query @{ LogName = 'Application'; Id = 1000, 1002; StartTime = $since } 200 @(0, 1, 3, 6)
        # D-EVT-02: unexpected shutdowns and bug checks (7 days). Filter by id only; providers checked after.
        # One query per provider: a mixed id query trips over providers without message resources.
        power = Event-Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 41; StartTime = $weekAgo } 50 @(0)
        dirty_shutdown = Event-Query @{ LogName = 'System'; ProviderName = 'EventLog'; Id = 6008; StartTime = $weekAgo } 50
        bugcheck = Event-Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; Id = 1001; StartTime = $weekAgo } 50 @(0)
        # D-EVT-03: WHEA hardware error records (7 days).
        whea = Event-Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $weekAgo } 50
        # D-GPU-02: display driver timeouts / resets (7 days).
        display = Event-Query @{ LogName = 'System'; Id = 4101; StartTime = $weekAgo } 50 @() { $_.ProviderName -eq 'Display' }
        # D-UPD-01: Windows Update install failures (14 days; props: error code, update title).
        update_failures = Event-Query @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WindowsUpdateClient'; Id = 20; StartTime = (Get-Date).AddDays(-14) } 50 @(0, 1)
        # Disk / storage / USB warnings and errors (adapted from PC-AI Get-SystemEvents).
        storage = Event-Query @{ LogName = 'System'; Level = 1, 2, 3; StartTime = (Get-Date).AddDays(-3) } 400 @() {
            $_.ProviderName -match 'disk|storahci|nvme|usbhub|USB|nvstor|iaStor|stornvme|partmgr|ntfs|volmgr' }
    }
}

Section 'devices' {
    # Adapted from PC-AI Get-DeviceErrors (CIM path).
    @(Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.ConfigManagerErrorCode -ne 0 } | ForEach-Object {
            [ordered]@{
                name = $_.Name; class = $_.PNPClass; manufacturer = $_.Manufacturer; status = $_.Status
                problem_code = [int]$_.ConfigManagerErrorCode
                problem = if ($ProblemCodes.ContainsKey([int]$_.ConfigManagerErrorCode)) { $ProblemCodes[[int]$_.ConfigManagerErrorCode] } else { 'Device problem' }
                present = $_.Present
            } })
}

Section 'disks' {
    # Adapted from PC-AI Get-DiskHealth: Storage module first, Win32_DiskDrive status as fallback.
    $rows = @()
    try {
        $rows = @(Get-PhysicalDisk | ForEach-Object {
                [ordered]@{ model = $_.FriendlyName; media = [string]$_.MediaType; bus = [string]$_.BusType; health = [string]$_.HealthStatus
                    operational = ($_.OperationalStatus -join ','); size_gb = [math]::Round($_.Size / 1GB, 1); source = 'Get-PhysicalDisk' } })
    } catch { }
    if ($rows.Count -eq 0) {
        $rows = @(Get-CimInstance -ClassName Win32_DiskDrive | ForEach-Object {
                [ordered]@{ model = $_.Model; media = $_.MediaType; bus = $_.InterfaceType; health = $_.Status; operational = $_.Status
                    size_gb = [math]::Round($_.Size / 1GB, 1); source = 'Win32_DiskDrive' } })
    }
    $rows
}

Section 'adapters' {
    # Adapted from PC-AI Get-NetworkAdapters (physical adapters only).
    @(Get-CimInstance -ClassName Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -eq $true } | ForEach-Object {
            [ordered]@{ name = $_.Name; connection = $_.NetConnectionID; enabled = $_.NetEnabled; status = [int]$_.NetConnectionStatus
                speed_mbps = if ($_.Speed) { [math]::Round($_.Speed / 1000000, 0) } else { $null } } })
}

Section 'netconfig' {
    # Default routes and DNS servers (Get-NetIPConfiguration is far slower for the same facts).
    $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric)
    $dns = @{}
    Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $dns[$_.InterfaceIndex] = @($_.ServerAddresses) }
    @($routes | ForEach-Object {
            [ordered]@{ interface = $_.InterfaceAlias; gateways = @($_.NextHop); metric = $_.RouteMetric
                dns_servers = @($dns[$_.InterfaceIndex]) } })
}

Section 'security' {
    $mp = $null; $mpError = $null
    try { $mp = Get-MpComputerStatus } catch { $mpError = $_.Exception.Message }
    $av = @()
    try { $av = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct | ForEach-Object { [ordered]@{ name = $_.displayName; state = [int]$_.productState } }) } catch { }
    [ordered]@{
        defender = if ($mp) { [ordered]@{ service = $mp.AMServiceEnabled; antivirus = $mp.AntivirusEnabled; realtime = $mp.RealTimeProtectionEnabled
                signature_age_days = $mp.AntivirusSignatureAge; tamper = $mp.IsTamperProtected } } else { $null }
        defender_error = $mpError
        antivirus_products = $av
        firewall = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ profile = [string]$_.Name; enabled = [bool]$_.Enabled } })
    }
}

Section 'services' {
    # Critical-service catalogue (D-SVC-01): expected running when start type is Automatic.
    $names = 'EventLog', 'Winmgmt', 'Dnscache', 'Dhcp', 'BFE', 'mpssvc', 'Audiosrv', 'AudioEndpointBuilder', 'wscsvc', 'WinDefend', 'nsi', 'LanmanWorkstation', 'CryptSvc', 'Schedule', 'PlugPlay', 'RpcSs', 'bthserv'
    @(Get-CimInstance -ClassName Win32_Service | Where-Object { $names -contains $_.Name } | ForEach-Object {
            [ordered]@{ name = $_.Name; display = $_.DisplayName; state = $_.State; start = $_.StartMode } })
}

Section 'battery' {
    $present = @(Get-CimInstance -ClassName Win32_Battery)
    if ($present.Count -eq 0) { return [ordered]@{ present = $false } }
    $design = @(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryStaticData -ErrorAction SilentlyContinue)
    $full = @(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue)
    $cycles = @(Get-CimInstance -Namespace 'root/wmi' -ClassName BatteryCycleCount -ErrorAction SilentlyContinue)
    $result = [ordered]@{
        present = $true
        charge_percent = $present[0].EstimatedChargeRemaining
        design_mwh = if ($design.Count) { [int64]$design[0].DesignedCapacity } else { $null }
        full_mwh = if ($full.Count) { [int64]$full[0].FullChargedCapacity } else { $null }
        cycles = if ($cycles.Count -and [int]$cycles[0].CycleCount -gt 0) { [int]$cycles[0].CycleCount } else { $null }
        source = 'WMI'
    }
    if (-not $result.design_mwh) {
        # Design capacity needs admin through WMI; the battery report has it for any user.
        # powercfg only writes this report file (to TEMP); it changes no settings.
        $xml = Join-Path $env:TEMP ("jarvis-battery-{0}.xml" -f $PID)
        try {
            & powercfg.exe /batteryreport /xml /output $xml | Out-Null
            [xml]$r = Get-Content -LiteralPath $xml -Raw
            $b = $r.BatteryReport.Batteries.Battery | Select-Object -First 1
            if ($b) {
                $result.design_mwh = [int64]$b.DesignCapacity
                $result.full_mwh = [int64]$b.FullChargeCapacity
                if ([int]$b.CycleCount -gt 0) { $result.cycles = [int]$b.CycleCount }
                $result.source = 'powercfg battery report'
            }
        } catch { } finally { Remove-Item -LiteralPath $xml -ErrorAction SilentlyContinue }
    }
    $result
}

Section 'startup' {
    @(Get-CimInstance -ClassName Win32_StartupCommand | Select-Object -First 40 | ForEach-Object {
            $cmd = [string]$_.Command
            $path = $null
            if ($cmd -match '^\s*"([^"]+)"') { $path = $Matches[1] } elseif ($cmd -match '^\s*(\S+\.exe)') { $path = $Matches[1] }
            if ($path) { $path = [Environment]::ExpandEnvironmentVariables($path) }
            $sig = $null; $signer = $null; $exists = $false
            try {
                $exists = [bool]($path -and (Test-Path -LiteralPath $path))
                if ($exists) {
                    $s = Get-AuthenticodeSignature -LiteralPath $path
                    $sig = [string]$s.Status
                    if ($s.SignerCertificate) { $signer = $s.SignerCertificate.GetNameInfo('SimpleName', $false) }
                }
            } catch { $sig = 'Unreadable' }
            [ordered]@{ name = $_.Name; location = $_.Location; path = $path; signature = $sig; signer = $signer; exists = $exists } })
}

Section 'bluetooth' {
    $radios = @(Get-CimInstance -ClassName Win32_PnPEntity | Where-Object { $_.PNPClass -eq 'Bluetooth' -and $_.Name -match 'Bluetooth|Wireless|Radio|Adapter' })
    [ordered]@{ adapters = @($radios | ForEach-Object { [ordered]@{ name = $_.Name; status = $_.Status; problem_code = [int]$_.ConfigManagerErrorCode } }) }
}

Section 'audio' {
    @(Get-CimInstance -ClassName Win32_SoundDevice | ForEach-Object { [ordered]@{ name = $_.Name; status = $_.Status; state = [int]$_.StatusInfo } })
}

$out | ConvertTo-Json -Depth 6 -Compress
