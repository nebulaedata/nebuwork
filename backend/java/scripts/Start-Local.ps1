param(
    [string]$ProjectName = '',
    [int]$Port = 42020,
    [string]$EnvFile = '',
    [switch]$Isolated
)
$ErrorActionPreference = 'Stop'
$moduleRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectName) { $ProjectName = if ($Isolated) { 'nebuwork-java-isolated' } else { 'nebuwork-java' } }
if (-not $EnvFile) { $EnvFile = if ($Isolated) { '.qa/isolated.env' } else { '.env' } }
$envPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $moduleRoot $EnvFile }
$composeFile = if ($Isolated) { 'compose.yml' } else { 'compose.nacos.yml' }
if (-not $Isolated -and -not (Test-Path -LiteralPath (Join-Path $moduleRoot 'config/nacos.properties') -PathType Leaf)) {
    throw 'Configure config/nacos.properties using config/nacos.example.properties before starting.'
}
if ($Isolated -and -not (Test-Path -LiteralPath $envPath)) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($envPath)) | Out-Null
    function New-LocalSecret {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        [Convert]::ToBase64String($bytes)
    }
    @(
        "NEBU_API_PORT=$Port"
        'NEBU_MYSQL_PORT=43316'
        'NEBU_REDIS_LOCAL_PORT=46389'
        "NEBU_DB_PASSWORD=$(New-LocalSecret)"
        "NEBU_MYSQL_ROOT_PASSWORD=$(New-LocalSecret)"
        'NEBU_REDIS_HOST=redis'
        'NEBU_REDIS_PORT=6379'
        'NEBU_REDIS_DATABASE=0'
        "NEBU_REDIS_PASSWORD=$(New-LocalSecret)"
        "NEBU_MODELS_ENCRYPTION_KEY=$(New-LocalSecret)"
        'NEBU_ALLOWED_ORIGINS=*'
    ) | Set-Content -LiteralPath $envPath -Encoding ascii
    Write-Host 'Created private configuration for isolated local services. Keep its encryption key stable.'
}
if (-not (Test-Path -LiteralPath $envPath)) { "NEBU_API_PORT=$Port" | Set-Content -LiteralPath $envPath -Encoding ascii }
Push-Location $moduleRoot
try {
    & docker compose -f $composeFile --env-file $envPath -p $ProjectName up -d --build
    if ($LASTEXITCODE -ne 0) { throw 'Local services failed to start; inspect docker compose logs.' }
    $binding = & docker compose -f $composeFile --env-file $envPath -p $ProjectName port api 42020
    if ($LASTEXITCODE -ne 0 -or -not $binding) { throw 'Unable to determine the API port.' }
    $healthUrl = "http://$($binding.Trim())/nwaa/api/health"
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
            if ($health.code -eq 0 -and $health.data.service -eq 'nebuwork-backend-api') { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw 'API did not become ready. Inspect docker compose logs api.' }
    Write-Host "API ready: $healthUrl"
    if ($Isolated) { Write-Host 'Business login requires the same Redis instance/database as the existing user service.' }
} finally { Pop-Location }
