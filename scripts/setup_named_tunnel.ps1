param(
    [Parameter(Mandatory = $true)]
    [string]$Hostname,
    [string]$TunnelName = "e-katalog",
    [string]$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    [string]$OriginUrl = "http://localhost:80",
    [switch]$InstallService = $true,
    [switch]$OverwriteDns = $true
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

function Require-File {
    param([string]$Path, [string]$Message)
    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        throw $Message
    }
}

if (-not (Test-Path $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared.exe not found at: $CloudflaredPath"
}

$cloudflaredDir = Join-Path $HOME ".cloudflared"
New-Item -ItemType Directory -Path $cloudflaredDir -Force | Out-Null

$certPath = Join-Path $cloudflaredDir "cert.pem"
if (-not (Test-Path $certPath -PathType Leaf)) {
    Write-Host "No Cloudflare origin cert found. Starting login..."
    & $CloudflaredPath tunnel login
    Require-File -Path $certPath -Message "Login was not completed. cert.pem not found at $certPath"
}

Write-Host "Checking tunnel '$TunnelName'..."
$infoCmd = "`"$CloudflaredPath`" tunnel info $TunnelName >nul 2>nul"
cmd /c $infoCmd | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating tunnel '$TunnelName'..."
    & $CloudflaredPath tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create tunnel '$TunnelName'."
    }
}

$listOut = & $CloudflaredPath tunnel list
$escapedTunnelName = [regex]::Escape($TunnelName)
$idMatch = $listOut | Select-String -Pattern "^(?<id>[0-9a-f-]{36})\s+$escapedTunnelName\s+"
if (-not $idMatch) {
    throw "Failed to resolve tunnel ID for '$TunnelName'."
}

$tunnelId = $idMatch[0].Matches[0].Groups["id"].Value
$credentialsPath = Join-Path $cloudflaredDir "$tunnelId.json"
Require-File -Path $credentialsPath -Message "Tunnel credentials not found: $credentialsPath"

Write-Host "Routing DNS: $Hostname -> tunnel '$TunnelName'..."
$routeArgs = @("tunnel", "route", "dns")
if ($OverwriteDns) {
    $routeArgs += "--overwrite-dns"
}
 $routeArgs += @($TunnelName, $Hostname)
& $CloudflaredPath @routeArgs
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create DNS route for $Hostname"
}

$configPath = Join-Path $cloudflaredDir "config.yml"
$configContent = @"
tunnel: $tunnelId
credentials-file: $credentialsPath

ingress:
  - hostname: $Hostname
    service: $OriginUrl
  - service: http_status:404
"@
$configContent | Set-Content -Path $configPath -Encoding ASCII

Write-Host "Config written: $configPath"

if ($InstallService) {
    Write-Host "Installing cloudflared Windows service..."
    & $CloudflaredPath service install
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Failed to install cloudflared service. Run PowerShell as Administrator and retry."
        Write-Warning "Fallback: use scripts/install_named_tunnel_autostart.ps1 for user-level autostart."
    }
    if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
        Start-Service cloudflared -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "Named tunnel is ready."
Write-Host "Public URL: https://$Hostname"
Write-Host "API health: https://$Hostname/api/v1/health"


