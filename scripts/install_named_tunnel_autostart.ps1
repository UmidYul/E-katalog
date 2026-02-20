param(
    [string]$TaskName = "E-katalog Named Tunnel",
    [string]$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    [string]$ConfigPath = "$HOME\.cloudflared\config.yml",
    [string]$TunnelName = "e-katalog",
    [string]$LogFile = "$HOME\.cloudflared\named-tunnel.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared.exe not found at: $CloudflaredPath"
}

if (-not (Test-Path $ConfigPath -PathType Leaf)) {
    throw "config.yml not found at: $ConfigPath"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null

$taskArgs = "--config `"$ConfigPath`" --no-autoupdate --logfile `"$LogFile`" tunnel run $TunnelName"
$userId = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute $CloudflaredPath -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "Autostart task created: $TaskName"
Write-Host "Command: `"$CloudflaredPath`" $taskArgs"
Write-Host "Log file: $LogFile"
Write-Host "To run now: Start-ScheduledTask -TaskName `"$TaskName`""
Write-Host "To remove: Unregister-ScheduledTask -TaskName `"$TaskName`" -Confirm:`$false"
