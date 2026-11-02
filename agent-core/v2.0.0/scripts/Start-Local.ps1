param(
    [string]$ProjectName = 'nebu-agent-engine-v2-0-0',
    [switch]$PlatformMcp,
    [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$moduleRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $moduleRoot '.env'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw 'Create the private .env from .env.example using the existing infrastructure and service credentials.'
}
Push-Location $moduleRoot
try {
    $composeArgs = @('compose', '--env-file', $envPath, '-f', 'deploy/compose.yml', '-p', $ProjectName)
    if ($PlatformMcp) { $composeArgs += @('--profile', 'platform-mcp') }
    & docker @composeArgs config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Deployment configuration is incomplete.' }
    $sandboxImage = 'nebu-agent-sandbox:1'
    $sandboxSetting = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^\s*SANDBOX_IMAGE=' } | Select-Object -Last 1
    if ($sandboxSetting) { $sandboxImage = ($sandboxSetting -split '=', 2)[1].Trim().Trim('"').Trim("'") }
    & docker image inspect $sandboxImage *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker build -t $sandboxImage -f deploy/sandbox.Dockerfile .
        if ($LASTEXITCODE -ne 0) { throw 'Sandbox image build failed.' }
    }
    $upArgs = @('up', '-d')
    if (-not $NoBuild) { $upArgs += '--build' }
    & docker @composeArgs @upArgs
    if ($LASTEXITCODE -ne 0) { throw 'Engine deployment failed; inspect its Compose logs.' }
    foreach ($service in @('api1', 'api2')) {
        $binding = & docker @composeArgs port $service 42110
        if ($LASTEXITCODE -ne 0 -or -not $binding) { throw "Unable to find $service port." }
        $url = "http://$($binding.Trim())/health/ready"
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            try { $health = Invoke-RestMethod -Uri $url -TimeoutSec 3; if ($health.status -eq 'ready') { $ready = $true; break } } catch { }
            Start-Sleep -Seconds 2
        }
        if (-not $ready) { throw "$service is not ready; inspect its Compose logs." }
        Write-Host "$service ready: $url"
    }
    Write-Host 'Engine started using the existing database, Redis, object storage and service credentials.'
} finally { Pop-Location }
