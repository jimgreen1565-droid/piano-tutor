$ErrorActionPreference = 'Continue'
$app = 'D:\ZW\Documents\deepseek-harness\default-workspace\Breeze-TTS-2.cpp\app\breeze-tts-2-v0.1.3-windows-x64-vulkan'
$exe = Join-Path $app 'breeze-server.exe'
$out = Join-Path $app 'logs\piano_coach.log'
$err = Join-Path $app 'logs\piano_coach.err.log'

# 1) 清掉残留实例（同端口并存会互相卡死）
Get-Process breeze-server -ErrorAction SilentlyContinue | ForEach-Object {
  Write-Output ("kill stale server pid=" + $_.Id)
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

# 2) 起一个干净实例（隐藏窗口、日志落盘）
Start-Process -FilePath $exe `
  -ArgumentList 'breeze-tts-2-q4_k.gguf','--host','127.0.0.1','--port','8080','--webui','--chunk-max','40' `
  -WorkingDirectory $app -WindowStyle Hidden `
  -RedirectStandardOutput $out -RedirectStandardError $err

# 3) 等就绪（最多 5 分钟）
$ready = $false
for ($i = 1; $i -le 60; $i++) {
  Start-Sleep -Seconds 5
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -TimeoutSec 4 -UseBasicParsing
    if ($r.StatusCode -eq 200) { Write-Output "READY after $($i*5)s : $($r.Content)"; $ready = $true; break }
  } catch { }
}
if (-not $ready) { Write-Output 'NOT READY within 300s'; }

# 4) 音色列表
try {
  $v = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/v1/voices' -TimeoutSec 20 -UseBasicParsing
  Write-Output ('VOICES: ' + $v.Content)
} catch {
  Write-Output ('voices probe failed: ' + $_.Exception.Message)
}

Write-Output '--- log tail ---'
if (Test-Path $out) { Get-Content $out -Tail 12 }
if ((Test-Path $err) -and (Get-Item $err).Length -gt 0) { Write-Output '--- err ---'; Get-Content $err -Tail 12 }
