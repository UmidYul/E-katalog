param(
    [string]$TaskName = "E-katalog Quick Tunnel",
    [string]$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
    [string]$OriginUrl = "http://localhost:80",
    [string]$LogFile = "$HOME\.cloudflared\quick-tunnel.log"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CloudflaredPath -PathType Leaf)) {
    throw "cloudflared.exe not found at: $CloudflaredPath"
}

New-Item -ItemType Directory -Path (Split-Path -Parent $LogFile) -Force | Out-Null

$taskArgs = "tunnel --url $OriginUrl --no-autoupdate --logfile `"$LogFile`""
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
