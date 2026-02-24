param(
    [string]$ComposeFile = "infra/docker/docker-compose.prod.yml",
    [switch]$SkipBuild,
    [switch]$RunQualitySmoke
)

$ErrorActionPreference = "Stop"

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found in PATH."
    }
}

function Assert-FileExists {
    param([string]$Path)
    if (-not (Test-Path -Path $Path -PathType Leaf)) {
        throw "Required file was not found: $Path"
    }
}

Write-Host "==> Validating local prerequisites..."
Require-Command "docker"

Assert-FileExists $ComposeFile

if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) {
        throw ".env is missing and .env.example was not found."
    }
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Update secrets before internet exposure."
}

$composeArgs = @("-f", $ComposeFile, "up", "-d")
if (-not $SkipBuild) {
    $composeArgs += "--build"
}

Write-Host "==> Starting containers..."
docker compose @composeArgs

Write-Host "==> Running migrations..."
docker compose -f $ComposeFile exec -T api alembic -c /srv/migrations/alembic.ini upgrade head

Write-Host "==> Health check..."
try {
    $health = Invoke-WebRequest -Uri "http://localhost/api/v1/health" -UseBasicParsing -TimeoutSec 15
    Write-Host "API health status code: $($health.StatusCode)"
} catch {
    Write-Warning "Health check failed at http://localhost/api/v1/health"
}

if ($RunQualitySmoke) {
    $qualityScript = Join-Path $PSScriptRoot "quality_smoke_check.ps1"
    if (-not (Test-Path -Path $qualityScript -PathType Leaf)) {
        throw "Quality smoke script was not found: $qualityScript"
    }
    Write-Host "==> Running quality smoke check..."
    & $qualityScript -BaseUrl "http://localhost"
}

Write-Host ""
Write-Host "Done."
Write-Host "Frontend: http://localhost"
Write-Host "API health: http://localhost/api/v1/health"
Write-Host ""
Write-Host "Useful commands:"
Write-Host "  docker compose -f $ComposeFile ps"
Write-Host "  docker compose -f $ComposeFile logs -f nginx"
Write-Host "  docker compose -f $ComposeFile logs -f api"
