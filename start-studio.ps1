$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Create .env from .env.example first.' }
if (-not (Test-Path -LiteralPath 'dist/index.html')) { throw 'Run npm ci and npm run build first.' }
$portLine = Get-Content -LiteralPath '.env' | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -Last 1
$studioPort = if ($portLine) { [int]($portLine.Split('=')[1]) } else { 3001 }
$existing = Get-NetTCPConnection -LocalPort $studioPort -State Listen -ErrorAction SilentlyContinue
if ($existing) { Write-Output "Port $studioPort is already in use. Check http://127.0.0.1:$studioPort"; exit }
New-Item -ItemType Directory -Force -Path 'data/logs' | Out-Null
$studioProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'data/logs/server.log' -RedirectStandardError 'data/logs/server-error.log' -PassThru
Write-Output "Video Studio is starting: http://127.0.0.1:$studioPort (PID $($studioProcess.Id))"
