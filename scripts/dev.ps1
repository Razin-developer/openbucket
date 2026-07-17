[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$StorageRoot = "./.openbucket-data"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$env:OPENBUCKET_SERVE_DASHBOARD = "false"
if (-not $env:OPENBUCKET_DASHBOARD_URL) { $env:OPENBUCKET_DASHBOARD_URL = "http://localhost:3000" }
$env:OPENBUCKET_OPEN_DASHBOARD = "false"
$started = $false

try {
  Write-Host "Starting OpenBucket daemon on $StorageRoot..."
  & npm run openbucket -- serve $StorageRoot --offline --no-tunnel --detach --no-open
  if ($LASTEXITCODE -ne 0) { throw "OpenBucket daemon startup failed with exit code $LASTEXITCODE." }
  $started = $true

  Write-Host "Starting dashboard development server..."
  Write-Host "Run 'npm run openbucket -- dashboard' in another terminal to pair and open it securely."
  Write-Host "After it is listening, run 'npm run openbucket -- dashboard' in another terminal to pair it."
  Write-Host "The daemon will be stopped when this script exits normally."
  & npm run dev
  if ($LASTEXITCODE -ne 0) { throw "Dashboard development server exited with code $LASTEXITCODE." }
} finally {
  if ($started) {
    & npm run openbucket -- stop | Out-Null
  }
}
