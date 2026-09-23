$ErrorActionPreference = 'Stop'
$labPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $labPython)) {
    throw 'Run powershell -ExecutionPolicy Bypass -File lab/bootstrap.ps1 first.'
}
Push-Location -LiteralPath $PSScriptRoot
try {
    & $labPython -m delphi_lab @args
    $labExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $labExitCode
