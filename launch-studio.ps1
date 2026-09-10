param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$studioMutex = New-Object Threading.Mutex($false, 'Local\PersonalVideoStudioLauncher')
$locked = $false
try {
  $locked = $studioMutex.WaitOne(30000)
  if (-not $locked) { throw 'Startup is already in progress. Try again in a minute.' }
  if (-not (Test-Path -LiteralPath '.env')) { throw 'Create .env from .env.example first.' }
  $settings = Get-Content -LiteralPath '.env'
  $portLine = $settings | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -Last 1
  $studioPort = if ($portLine) { [int]($portLine.Split('=')[1]) } else { 3001 }
  $studioUrl = "http://127.0.0.1:$studioPort"
  $assetLine = $settings | Where-Object { $_ -match '^PUBLIC_ASSET_BASE_URL=https://.+' } | Select-Object -Last 1
  $fixedAssetUrl = if ($assetLine) { ($assetLine -replace '^PUBLIC_ASSET_BASE_URL=', '').TrimEnd('/') } else { '' }
  $autoTunnel = [bool]($settings | Where-Object { $_ -match '^AUTO_PUBLIC_MEDIA_TUNNEL=true$' })
  New-Item -ItemType Directory -Force -Path 'data/logs','data/runtime' | Out-Null
  $vpnLine = $settings | Where-Object { $_ -match '^VPN_APP_PATH=.+' } | Select-Object -Last 1
  $vpnPath = if ($vpnLine) { ($vpnLine -replace '^VPN_APP_PATH=', '').Trim('"') } else { '' }
  if ($vpnPath -and (Test-Path -LiteralPath $vpnPath)) {
    $vpnName = [IO.Path]::GetFileNameWithoutExtension($vpnPath)
    if (-not (Get-Process -Name $vpnName -ErrorAction SilentlyContinue)) {
      Start-Process -FilePath $vpnPath -WindowStyle Hidden
    }
  }
  function Test-Studio {
    try { $health = Invoke-RestMethod "$studioUrl/api/health" -TimeoutSec 2; return ($health.app -in @('openrouter-video-studio','personal-video-studio')) } catch { return $false }
  }
  function Get-StudioConfig {
    try { return Invoke-RestMethod "$studioUrl/api/config" -TimeoutSec 2 } catch { return $null }
  }
  function Stop-PreviousTunnel {
    $statePath = 'data/runtime/public-media-tunnel.json'
    if (-not (Test-Path -LiteralPath $statePath)) { return }
    try {
      $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
      $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
      if ($process -and $process.ProcessName -eq 'cloudflared') { Stop-Process -Id $process.Id -Force }
    } catch { }
  }
  function Test-PublicTunnelState {
    if (-not (Test-Path -LiteralPath 'data/runtime/public-media-tunnel.json')) { return $false }
    try {
      $state = Get-Content -LiteralPath 'data/runtime/public-media-tunnel.json' -Raw | ConvertFrom-Json
      $process = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
      return [bool]($process -and $process.ProcessName -eq 'cloudflared')
    } catch { return $false }
  }
  function Start-PublicMediaTunnel {
    $cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
    if (-not $cloudflared) { throw 'MP4 upload requires cloudflared. Install Cloudflare Tunnel or set PUBLIC_ASSET_BASE_URL in .env.' }
    Stop-PreviousTunnel
    $tunnelLog = Join-Path $PSScriptRoot 'data/logs/cloudflared.log'
    $tunnelError = Join-Path $PSScriptRoot 'data/logs/cloudflared-error.log'
    Set-Content -LiteralPath $tunnelLog -Value ''
    Set-Content -LiteralPath $tunnelError -Value ''
    # HTTP/2 is often more reliable through local VPN and proxy clients.
    $tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @('tunnel','--url',"http://127.0.0.1:$studioPort",'--protocol','http2','--no-autoupdate') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelError -PassThru
    $publicUrl = $null
    for ($attempt=0; $attempt -lt 60; $attempt++) {
      if ($tunnelProcess.HasExited) { break }
      $text = ((Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue))
      $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
      if ($match.Success) { $publicUrl = $match.Value; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $publicUrl) {
      if (-not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force }
      throw 'Cloudflare Tunnel did not return a public URL. Check your VPN/proxy and data/logs/cloudflared-error.log.'
    }
    # A generated hostname is not enough: wait until the edge registers the connector.
    $registered = $false
    for ($stabilityCheck=0; $stabilityCheck -lt 60; $stabilityCheck++) {
      if ($tunnelProcess.HasExited) { break }
      $connectionText = ((Get-Content -LiteralPath $tunnelLog -Raw -ErrorAction SilentlyContinue) + "`n" + (Get-Content -LiteralPath $tunnelError -Raw -ErrorAction SilentlyContinue))
      if ($connectionText -match 'Registered tunnel connection') { $registered = $true; break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $registered) {
      if (-not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force }
      throw 'Cloudflare returned a URL but did not register the connection. Check your VPN/proxy and access to TCP port 7844.'
    }
    @{ pid = $tunnelProcess.Id; url = $publicUrl; startedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath 'data/runtime/public-media-tunnel.json'
    return $publicUrl
  }
  $studioConfig = if (Test-Studio) { Get-StudioConfig } else { $null }
  $staleAutomaticTunnel = $studioConfig -and $autoTunnel -and -not $fixedAssetUrl -and $studioConfig.videoUploadsConfigured -and -not (Test-PublicTunnelState)
  if ($studioConfig -and (($fixedAssetUrl -or $autoTunnel) -and -not $studioConfig.videoUploadsConfigured -or $staleAutomaticTunnel)) {
    $listener = Get-NetTCPConnection -LocalPort $studioPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) { Stop-Process -Id $listener.OwningProcess -Force; Start-Sleep -Milliseconds 500 }
    $studioConfig = $null
  }
  if (-not (Test-Studio)) {
    if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE -ne 0) { throw 'Could not install dependencies.' } }
    if (-not (Test-Path -LiteralPath 'dist/index.html')) { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Could not build the interface.' } }
    if ($fixedAssetUrl) { $env:PUBLIC_ASSET_BASE_URL = $fixedAssetUrl }
    elseif ($autoTunnel) {
      try { $env:PUBLIC_ASSET_BASE_URL = Start-PublicMediaTunnel }
      catch { $tunnelWarning = $_.Exception.Message; $env:PUBLIC_ASSET_BASE_URL = '' }
    }
    $studioProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput 'data/logs/server.log' -RedirectStandardError 'data/logs/server-error.log' -PassThru
    $ready = $false
    for ($attempt=0; $attempt -lt 30; $attempt++) {
      if (Test-Studio) { $ready=$true; break }
      if ($studioProcess.HasExited) { break }
      Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'The studio did not start. Check data/logs/server-error.log and the server port.' }
  }
  $studioConfig = Get-StudioConfig
  if (-not $NoBrowser) { Start-Process -FilePath $studioUrl }
  Write-Output "Video Studio: $studioUrl"
  if ($studioConfig.publicAssetBaseUrl) { Write-Output "Video references: $($studioConfig.publicAssetBaseUrl)/media/…" }
  elseif ($tunnelWarning) { Write-Warning "MP4 upload disabled: $tunnelWarning" }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, 'Video Studio') | Out-Null
  throw
} finally {
  if ($locked) { $studioMutex.ReleaseMutex() }
  $studioMutex.Dispose()
}
