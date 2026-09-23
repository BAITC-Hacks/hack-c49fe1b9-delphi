$ErrorActionPreference = 'Stop'
$labPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $labPython)) {
    python -m venv (Join-Path $PSScriptRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create lab virtual environment.' }
}
$labRequirements = Join-Path $PSScriptRoot 'requirements.lock.txt'
if (-not (Test-Path -LiteralPath $labRequirements)) {
    $labRequirements = Join-Path $PSScriptRoot 'requirements.txt'
}
& $labPython -m pip install --disable-pip-version-check --cache-dir (Join-Path $PSScriptRoot '.cache/pip') -r $labRequirements
if ($LASTEXITCODE -ne 0) { throw 'Cannot install lab dependencies.' }
Write-Host 'Ready: powershell -ExecutionPolicy Bypass -File lab/run.ps1 demo --allow-limited'
