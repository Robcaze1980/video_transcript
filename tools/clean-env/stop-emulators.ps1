# Stops ONLY the process tree recorded in <Boot>\emulators.pid and reports whether ports 18765-18769 are free.
# Usage: powershell -File tools/clean-env/stop-emulators.ps1 -Boot <boot-dir>
param([Parameter(Mandatory = $true)][string]$Boot)
$ErrorActionPreference = 'Stop'
$pidFile = Join-Path $Boot 'emulators.pid'
if (-not (Test-Path $pidFile)) { throw 'No emulators.pid in this boot directory; nothing of ours to stop.' }
$id = [int](Get-Content $pidFile)
taskkill /PID $id /T /F | Out-Null
Start-Sleep -Seconds 3
$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 18765 -and $_.LocalPort -le 18769 }
if ($busy) { $busy | ForEach-Object { "still listening: $($_.LocalPort) pid $($_.OwningProcess)" } } else { 'ports 18765-18769 are free' }
