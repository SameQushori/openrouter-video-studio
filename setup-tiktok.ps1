$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$tools = Join-Path $PSScriptRoot 'tools'
$target = Join-Path $tools 'yt-dlp.exe'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
Write-Output 'Downloading official yt-dlp for Windows...'
Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $target
& $target --version
Write-Output "Ready: $target"
