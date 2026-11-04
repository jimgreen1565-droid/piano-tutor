$ErrorActionPreference = 'Continue'
$app = 'D:\ZW\Documents\deepseek-harness\default-workspace\Breeze-TTS-2.cpp\app\breeze-tts-2-v0.1.3-windows-x64-vulkan'
$mode = $args[0]
if (-not $mode) { $mode = 'vulkan' }

Get-Process breeze-server -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("kill stale pid=" + $_.Id)
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$logName = "piano_$mode.log"
$extra = @('--no-warmup','--verbose')
if ($mode -eq 'cpu') { $extra += '--cpu' }

Start-Process -FilePath (Join-Path $app 'breeze-server.exe') `
  -ArgumentList (@('breeze-tts-2-q4_k.gguf','--host','127.0.0.1','--port','8080','--chunk-max','40') + $extra) `
  -WorkingDirectory $app -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $app "logs\$logName") `
  -RedirectStandardError (Join-Path $app "logs\$logName.err")

$ready = $false
for ($i = 1; $i -le 24; $i++) {
  Start-Sleep -Seconds 3
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Write-Output ("READY[" + $mode + "] after " + ($i*3) + "s"); $ready = $true; break }
  } catch { }
}
if (-not $ready) { Write-Output ("NOT READY[" + $mode + "]") }
Write-Output '--- log ---'
Get-Content (Join-Path $app "logs\$logName") -Tail 15
