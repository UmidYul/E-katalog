param(
    [string]$LogFile = "$HOME\.cloudflared\quick-tunnel.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $LogFile -PathType Leaf)) {
    throw "Log file not found: $LogFile"
}

$match = Select-String -Path $LogFile -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches |
    Select-Object -Last 1

if (-not $match) {
    throw "No trycloudflare URL found in log yet."
}

$url = $match.Matches[-1].Value
Write-Output $url
