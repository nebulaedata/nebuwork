param([switch]$NoBuild, [switch]$Preview)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dev = Join-Path $repo 'deploy/dev'
function Invoke-Docker { & docker @args; if ($LASTEXITCODE -ne 0) { throw "Docker command failed (exit $LASTEXITCODE)." } }
Push-Location $repo
try {
    Invoke-Docker info --format '{{.OSType}}'
    Invoke-Docker run --rm --mount "type=bind,source=$dev,target=/workspace/dev" -w /workspace/dev node:22.19.0-slim node init.mjs
    $common = @('compose', '--env-file', (Join-Path $dev '.env'))
    $component = $common + @('-f', (Join-Path $dev 'compose.component.yml'))
    $app = $common + @('-f', (Join-Path $dev 'compose.app.yml'))
    if ($Preview) { $app += @('--profile', 'preview') }
    Invoke-Docker @component config --quiet
    Invoke-Docker @app config --quiet
    Invoke-Docker @component up -d --wait --wait-timeout 600 mysql redis minio nacos knowledge-postgres knowledge-graph
    Invoke-Docker @component run --rm --no-deps init
    if (!$NoBuild) {
        Invoke-Docker build -t nebuwork-dev-sandbox:2.0.0 -f (Join-Path $repo 'agent-core/v2.0.0/deploy/sandbox.Dockerfile') (Join-Path $repo 'agent-core/v2.0.0')
        Invoke-Docker @app build frontend backend engine-api1 workflow knowledge-v101 knowledge-v101-extraction
        if ($Preview) { Invoke-Docker @app build preview-worker }
    }
    $services = @('frontend', 'backend', 'engine-api1', 'engine-api2', 'engine-worker', 'platform-mcp', 'workflow', 'workflow-ui', 'knowledge-v101', 'knowledge-v101-extraction')
    if ($Preview) { $services += 'preview-worker' }
    Invoke-Docker @app up -d --wait --wait-timeout 900 @services
    Invoke-Docker @app run --rm --no-deps init
    Write-Host 'NebuWork dev is ready. Credentials: .\scripts\Get-DevAccess.ps1'
    & (Join-Path $PSScriptRoot 'Get-DevAccess.ps1') -HidePassword
} finally { Pop-Location }
