param([switch]$HidePassword)
$ErrorActionPreference = 'Stop'
$envPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/dev/.env'
if (!(Test-Path -LiteralPath $envPath)) { throw 'Start the dev environment first.' }
$values = @{}
foreach ($line in [IO.File]::ReadAllLines($envPath)) {
    if ($line -match '^([^#=]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
}
$frontends = @(
    @{ Name = 'NebuWork'; Port = $values.DEV_HTTP_PORT; Path = '' },
    @{ Name = 'Knowledge V101'; Port = $values.DEV_KNOWLEDGE_HTTP_PORT; Path = '' },
    @{ Name = 'Workflow'; Port = $values.DEV_WORKFLOW_HTTP_PORT; Path = '' },
    @{ Name = 'Neo4j Browser'; Port = $values.DEV_NEO4J_HTTP_PORT; Path = '/browser/' },
    @{ Name = 'Nacos'; Port = $values.DEV_NACOS_PORT; Path = '/nacos/' },
    @{ Name = 'MinIO Console'; Port = $values.DEV_MINIO_CONSOLE_PORT; Path = '' }
)
foreach ($entry in $frontends) {
    Write-Host ("{0}: http://localhost:{1}{2}" -f $entry.Name, $entry.Port, $entry.Path)
}
$lanAddresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|VMware|Loopback' } |
    Select-Object -ExpandProperty IPAddress -Unique
foreach ($address in $lanAddresses) {
    foreach ($entry in $frontends) {
        Write-Host ("LAN {0}: http://{1}:{2}{3}" -f $entry.Name, $address, $entry.Port, $entry.Path)
    }
}
Write-Host ("Neo4j Bolt: bolt://localhost:{0} (LAN: replace localhost with the host IP)" -f $values.DEV_NEO4J_BOLT_PORT)
Write-Host ("Account: {0}" -f $values.DEV_ADMIN_ACCOUNT)
if (!$HidePassword) { Write-Host ("Initial password: {0}" -f $values.DEV_ADMIN_PASSWORD) }
Write-Host ("Workflow account: {0}" -f $values.WORKFLOW_UI_ACCOUNT)
if (!$HidePassword) { Write-Host ("Workflow password: {0}" -f $values.WORKFLOW_UI_PASSWORD) }
Write-Host 'Other credentials in deploy/dev/.env: Nacos=nacos/NACOS_PASSWORD; MinIO=MINIO_ROOT_USER/MINIO_ROOT_PASSWORD; Neo4j=neo4j/KNOWLEDGE_GRAPH_PASSWORD.'
