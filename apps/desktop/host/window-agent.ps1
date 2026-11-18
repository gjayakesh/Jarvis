# JARVIS window agent.
# Long-running helper started by jarvis-host.mjs. Reads one command per line on
# stdin and controls only the JARVIS app window (a Chrome window whose process
# was started with the JARVIS profile and whose title starts with "JARVIS").
# Input lines: "<id> <command>" with command show | hide | state.
# Output: "ready" once started, then "<id> ok:<state>" or "<id> err:<reason>" per request.
param([Parameter(Mandatory = $true)][string]$ProfileDir)
$ErrorActionPreference = 'Stop'

Add-Type -Namespace Jarvis -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr hWnd, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, System.IntPtr lParam);
[DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int pid);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr hWnd, System.Text.StringBuilder s, int max);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr hWnd, System.Text.StringBuilder s, int max);
[DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, System.UIntPtr extra);
'@

$script:hwnd = [IntPtr]::Zero

function Get-JarvisPids {
  $needle = $ProfileDir.ToLowerInvariant()
  Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) } |
    ForEach-Object { [int]$_.ProcessId }
}

function Find-JarvisWindow {
  if ($script:hwnd -ne [IntPtr]::Zero -and [Jarvis.Win]::IsWindow($script:hwnd)) { return $script:hwnd }
  $pids = @(Get-JarvisPids)
  if ($pids.Count -eq 0) { return [IntPtr]::Zero }
  $script:found = [IntPtr]::Zero
  $script:pidList = $pids
  $cb = [Jarvis.Win+EnumProc] {
    param($h, $l)
    $procId = 0
    [void][Jarvis.Win]::GetWindowThreadProcessId($h, [ref]$procId)
    if ($script:pidList -contains $procId) {
      $cls = New-Object System.Text.StringBuilder 64
      [void][Jarvis.Win]::GetClassName($h, $cls, 64)
      $title = New-Object System.Text.StringBuilder 256
      [void][Jarvis.Win]::GetWindowText($h, $title, 256)
      if ($cls.ToString() -eq 'Chrome_WidgetWin_1' -and $title.ToString().StartsWith('JARVIS')) {
        $script:found = $h
        return $false
      }
    }
    return $true
  }
  [void][Jarvis.Win]::EnumWindows($cb, [IntPtr]::Zero)
  $script:hwnd = $script:found
  return $script:found
}

function Get-State($h) {
  if ($h -eq [IntPtr]::Zero) { return 'missing' }
  if (-not [Jarvis.Win]::IsWindowVisible($h)) { return 'hidden' }
  if ([Jarvis.Win]::IsIconic($h)) { return 'minimized' }
  return 'shown'
}

[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $parts = $line.Trim().Split(' ', 2)
  $id = $parts[0]
  $cmd = if ($parts.Count -gt 1) { $parts[1] } else { '' }
  try {
    $h = Find-JarvisWindow
    switch ($cmd) {
      'show' {
        if ($h -eq [IntPtr]::Zero) { [Console]::Out.WriteLine("$id err:no-window"); break }
        [void][Jarvis.Win]::ShowWindow($h, 5)          # SW_SHOW
        if ([Jarvis.Win]::IsIconic($h)) { [void][Jarvis.Win]::ShowWindow($h, 9) }  # SW_RESTORE
        # Windows only lets the foreground app hand over focus; a synthetic Alt tap lets us take it.
        [Jarvis.Win]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [Jarvis.Win]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        [void][Jarvis.Win]::BringWindowToTop($h)
        [void][Jarvis.Win]::SetForegroundWindow($h)
        [Console]::Out.WriteLine("$id ok:" + (Get-State $h))
      }
      'hide' {
        if ($h -eq [IntPtr]::Zero) { [Console]::Out.WriteLine("$id err:no-window"); break }
        [void][Jarvis.Win]::ShowWindow($h, 0)          # SW_HIDE
        [Console]::Out.WriteLine("$id ok:" + (Get-State $h))
      }
      'state' { [Console]::Out.WriteLine("$id ok:" + (Get-State $h)) }
      default { [Console]::Out.WriteLine("$id err:unknown-command") }
    }
  } catch {
    [Console]::Out.WriteLine("$id err:" + ($_.Exception.Message -replace '\s+', ' '))
  }
}
