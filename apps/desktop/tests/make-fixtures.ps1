# Generates synthetic speech fixtures for the voice-matcher tests using the
# speech voices built into Windows. Output: tests/fixtures/audio/*.wav (16 kHz mono).
# Run: powershell -ExecutionPolicy Bypass -File tests/make-fixtures.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'fixtures/audio'
New-Item -ItemType Directory -Force -Path $out | Out-Null

Add-Type -AssemblyName System.Speech
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

function Say-Desktop($voice, $text, $rate, $file) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($voice)
  $s.Rate = $rate
  $s.SetOutputToWaveFile((Join-Path $out $file), $format)
  $s.Speak($text)
  $s.Dispose()
}

$phrases = @{ 'wake' = 'Hey Jarvis'; 'monitor' = 'Open monitor'; 'hello' = 'Hello there, how are you'; 'travis' = 'Hey Travis'; 'weather' = 'What is the weather' }
foreach ($r in -2, -1, 0, 1, 2) {
  Say-Desktop 'Microsoft David Desktop' $phrases.wake $r "david-wake-$($r + 2).wav"
  Say-Desktop 'Microsoft David Desktop' $phrases.monitor $r "david-monitor-$($r + 2).wav"
}
Say-Desktop 'Microsoft David Desktop' $phrases.hello 0 'david-hello.wav'
Say-Desktop 'Microsoft David Desktop' $phrases.travis 0 'david-travis.wav'
Say-Desktop 'Microsoft David Desktop' $phrases.weather 0 'david-weather.wav'
foreach ($r in 0, 1) {
  Say-Desktop 'Microsoft Zira Desktop' $phrases.wake $r "zira-wake-$r.wav"
  Say-Desktop 'Microsoft Zira Desktop' $phrases.monitor $r "zira-monitor-$r.wav"
}

# OneCore voices (other male speakers) through the WinRT synthesiser.
try {
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  foreach ($name in 'Mark', 'Ravi') {
    $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$name*" } | Select-Object -First 1
    if (-not $v) { continue }
    $synth.Voice = $v
    foreach ($k in 'wake', 'monitor') {
      $stream = Await ($synth.SynthesizeTextToStreamAsync($phrases[$k])) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
      $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
      $size = [uint32]$stream.Size
      Await ($reader.LoadAsync($size)) ([uint32]) | Out-Null
      $bytes = New-Object byte[] $size
      $reader.ReadBytes($bytes)
      [IO.File]::WriteAllBytes((Join-Path $out "$($name.ToLower())-$k.wav"), $bytes)
    }
  }
} catch { Write-Warning "OneCore voices skipped: $_" }
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize
