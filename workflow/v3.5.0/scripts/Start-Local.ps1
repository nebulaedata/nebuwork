param(
    [switch]$Isolated,
    [int]$Port = 0,
    [switch]$Sync
)
$ErrorActionPreference = 'Stop'
$moduleRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $moduleRoot '.venv/Scripts/python.exe'
Push-Location $moduleRoot
try {
    if ($Sync -or -not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
        $uv = (Get-Command uv -ErrorAction Stop).Source
        & $uv sync --frozen --extra server --extra dev --extra mcp
        if ($LASTEXITCODE -ne 0) { throw 'Workflow dependency installation failed.' }
    }
    $launchArgs = @('-B', '-u', '-X', 'utf8', (Join-Path $moduleRoot 'start_workflow.py'))
    if ($Isolated) { $launchArgs += '--isolated' }
    if ($Port -gt 0) { $launchArgs += @('--port', [string]$Port) }
    & $pythonPath @launchArgs
    if ($LASTEXITCODE -notin @(0, 130)) { throw "Workflow exited with code $LASTEXITCODE." }
} finally { Pop-Location }
