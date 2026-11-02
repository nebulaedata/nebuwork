$ErrorActionPreference = 'Stop'
$dev = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/dev'
foreach ($file in @('compose.app.yml','compose.component.yml')) {
    & docker compose --env-file (Join-Path $dev '.env') -f (Join-Path $dev $file) --profile preview stop
    if ($LASTEXITCODE -ne 0) { throw 'Failed to stop dev services.' }
}
Write-Host 'Dev services stopped; all data volumes and credentials are preserved.'
