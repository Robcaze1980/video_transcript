# Creates the synthetic bootstrap directory the strict launcher requires and prints its path.
# Usage: powershell -File tools/clean-env/new-boot.ps1
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$boot = Join-Path $repo ("outputs\lv019-b-review-browser-bootstrap\boot-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path (Join-Path $boot 'profile'), (Join-Path $boot 'temp') -Force | Out-Null
$marker = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
Set-Content -Path (Join-Path $boot 'profile\.synthetic-bootstrap-owner') -Value $marker -NoNewline -Encoding ascii
$boot
