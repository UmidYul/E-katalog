param(
    [string]$BaseUrl = "http://localhost",
    [string]$Email,
    [string]$Password,
    [int]$WaitTimeoutSec = 120,
    [int]$PollIntervalSec = 2
)

$ErrorActionPreference = "Stop"

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )
    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        return $null
    }
    $pattern = "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$"
    foreach ($line in (Get-Content -Path $Path)) {
        if ($line -match "^\s*#") {
            continue
        }
        if ($line -match $pattern) {
            $raw = $Matches[1]
            if ($null -eq $raw) {
                $raw = ""
            }
            $value = [string]$raw
            $value = $value.Trim()
            if ($value.StartsWith("'") -and $value.EndsWith("'") -and $value.Length -ge 2) {
                return $value.Substring(1, $value.Length - 2)
            }
            if ($value.StartsWith('"') -and $value.EndsWith('"') -and $value.Length -ge 2) {
                return $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $null
}

function Format-Percent {
    param([object]$Value)
    try {
        return "{0:N2}%" -f ([double]$Value * 100.0)
    } catch {
        return "n/a"
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$envPath = Join-Path $repoRoot ".env"

if ([string]::IsNullOrWhiteSpace($Email)) {
    $Email = Get-EnvValue -Path $envPath -Key "ADMIN_EMAIL"
}
if ([string]::IsNullOrWhiteSpace($Password)) {
    $Password = Get-EnvValue -Path $envPath -Key "ADMIN_PASSWORD"
}

if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($Password)) {
    throw "Admin credentials are required. Provide -Email/-Password or set ADMIN_EMAIL and ADMIN_PASSWORD in .env."
}

$base = $BaseUrl.TrimEnd("/")
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

Write-Host "==> Logging in as admin..."
$loginPayload = @{ email = $Email; password = $Password } | ConvertTo-Json
Invoke-RestMethod `
    -Method Post `
    -Uri "$base/api/v1/auth/login" `
    -WebSession $session `
    -ContentType "application/json" `
    -Body $loginPayload | Out-Null

Write-Host "==> Triggering quality report..."
$enqueue = Invoke-RestMethod -Method Post -Uri "$base/api/v1/admin/quality/reports/run" -WebSession $session
$taskId = [string]$enqueue.task_id
if ($null -eq $taskId) {
    $taskId = ""
}
if ([string]::IsNullOrWhiteSpace($taskId)) {
    throw "Could not enqueue quality report: empty task_id."
}
Write-Host "Task queued: $taskId ($($enqueue.queued))"

$deadline = (Get-Date).AddSeconds([Math]::Max(10, $WaitTimeoutSec))
$taskStatus = $null
do {
    Start-Sleep -Seconds ([Math]::Max(1, $PollIntervalSec))
    $taskStatus = Invoke-RestMethod -Method Get -Uri "$base/api/v1/admin/tasks/$taskId" -WebSession $session
    $progress = 0
    if ($null -ne $taskStatus.progress) {
        $progress = [int]$taskStatus.progress
    }
    Write-Host ("  state={0} progress={1}%" -f $taskStatus.state, $progress)
    if ($taskStatus.ready -eq $true) {
        break
    }
} while ((Get-Date) -lt $deadline)

if ($taskStatus -eq $null -or $taskStatus.ready -ne $true) {
    throw "Timed out waiting for quality task completion (task_id=$taskId)."
}
if ($taskStatus.successful -ne $true -and [string]$taskStatus.state -ne "SUCCESS") {
    $infoJson = $taskStatus.info | ConvertTo-Json -Depth 20 -Compress
    throw "Quality task failed (state=$($taskStatus.state), info=$infoJson)."
}

Write-Host "==> Fetching latest quality report..."
$latest = Invoke-RestMethod -Method Get -Uri "$base/api/v1/admin/quality/reports/latest" -WebSession $session

Write-Host "==> Fetching admin analytics..."
$analytics = Invoke-RestMethod -Method Get -Uri "$base/api/v1/admin/analytics?period=7d" -WebSession $session
$analyticsQuality = $analytics.quality_report

if ($null -eq $analyticsQuality) {
    throw "admin analytics does not include quality_report."
}

$summary = $latest.summary
$autoheal = $summary.autoheal

Write-Host ""
Write-Host "Quality smoke check passed."
Write-Host ("Report ID: {0}" -f $latest.id)
Write-Host ("Status: {0}" -f $latest.status)
Write-Host ("Search mismatch ratio: {0}" -f (Format-Percent $summary.search_mismatch_ratio))
Write-Host ("No valid offers ratio: {0}" -f (Format-Percent $summary.active_without_valid_offers_ratio))
Write-Host ("Low quality image ratio: {0}" -f (Format-Percent $summary.low_quality_image_ratio))
if ($null -ne $autoheal) {
    Write-Host ("Autoheal: enabled={0}, triggered={1}, attempted={2}, fixed={3}" -f $autoheal.enabled, $autoheal.triggered, $autoheal.attempted_products, $autoheal.fixed_products)
}

$result = [PSCustomObject]@{
    task_id = $taskId
    task_state = $taskStatus.state
    latest_report_id = $latest.id
    latest_report_status = $latest.status
    latest_report_created_at = $latest.created_at
    analytics_quality_report_id = $analyticsQuality.id
    analytics_quality_report_status = $analyticsQuality.status
    ratios = [PSCustomObject]@{
        search_mismatch = $summary.search_mismatch_ratio
        no_valid_offers = $summary.active_without_valid_offers_ratio
        low_quality_image = $summary.low_quality_image_ratio
    }
    autoheal = $autoheal
}

Write-Host ""
$result | ConvertTo-Json -Depth 20
