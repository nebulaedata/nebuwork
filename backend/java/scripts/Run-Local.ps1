param(
    [switch]$Build,
    [string]$Profile = ''
)
$ErrorActionPreference = 'Stop'
$moduleRoot = Split-Path -Parent $PSScriptRoot
# Nacos credentials are read from Git-ignored config/nacos.properties during bootstrap.
$javaCommand = if ($env:JAVA_HOME) { Join-Path $env:JAVA_HOME 'bin/java.exe' } else { (Get-Command java -ErrorAction Stop).Source }
if ($Build) {
    $mavenCommand = if ($env:NEBU_MAVEN_CMD) { $env:NEBU_MAVEN_CMD } else { (Get-Command mvn -ErrorAction Stop).Source }
    & $mavenCommand -f (Join-Path $moduleRoot 'pom.xml') clean package
    if ($LASTEXITCODE -ne 0) { throw 'Java build or tests failed.' }
}
$jarPath = Join-Path $moduleRoot 'target/nebuwork-backend-api.jar'
if (-not (Test-Path -LiteralPath $jarPath)) { throw 'Build first with -Build.' }
Push-Location $moduleRoot
try {
    $javaArgs = @('-Dfile.encoding=UTF-8', '-jar', $jarPath)
    if ($Profile) { $javaArgs += "--spring.profiles.active=$Profile" }
    & $javaCommand @javaArgs
    if ($LASTEXITCODE -ne 0) { throw "Java service exited with code $LASTEXITCODE." }
} finally { Pop-Location }
