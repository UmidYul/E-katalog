param(
    [string]$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    [string]$OriginUrl = "http://localhost:80",
    [string]$LogFile = "$HOME\.cloudflared\quick-tunnel.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared.exe not found at: $CloudflaredPath"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null

Write-Host "Starting quick tunnel to $OriginUrl"
Write-Host "Keep this terminal open. Press Ctrl+C to stop."
Write-Host "Log file: $LogFile"

& $CloudflaredPath tunnel --url $OriginUrl --no-autoupdate --logfile $LogFile
