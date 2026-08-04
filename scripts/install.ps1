[CmdletBinding()]
param(
  [string]$Package,
  [string]$Version,
  [string]$Prefix,
  [int]$TimeoutSeconds,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Install OpenBucket's npm package globally.

Usage: ./install.ps1 [-Package SPEC] [-Version VERSION] [-Prefix DIRECTORY] [-TimeoutSeconds N]

Package may be an npm name, tarball URL, .tgz file, or local directory.
Defaults come from OPENBUCKET_NPM_PACKAGE, OPENBUCKET_INSTALL_VERSION, and
OPENBUCKET_NPM_PREFIX. The package name otherwise defaults to openbucket.
-TimeoutSeconds aborts npm install after N seconds (default 120, or
OPENBUCKET_INSTALL_TIMEOUT).

If the install hangs rather than failing outright, it is almost always a
broken IPv6 route: DNS returns both an A and an AAAA record for the npm
registry, Node.js picks the AAAA record, and that connection attempt times
out slowly before falling back. This script already sets
NODE_OPTIONS=--dns-result-order=ipv4first and shortens npm's fetch retry
backoff to fail fast instead of hanging for minutes.

The script does not elevate, install an OS service, change PATH, open ports, or
modify firewall rules. It installs the selected package through npm only.
"@
  exit 0
}

if (-not $Package) {
  $Package = if ($env:OPENBUCKET_NPM_PACKAGE) { $env:OPENBUCKET_NPM_PACKAGE } else { "openbucket" }
}
if (-not $Version -and $env:OPENBUCKET_INSTALL_VERSION) { $Version = $env:OPENBUCKET_INSTALL_VERSION }
if (-not $Prefix -and $env:OPENBUCKET_NPM_PREFIX) { $Prefix = $env:OPENBUCKET_NPM_PREFIX }
if (-not $TimeoutSeconds) {
  $TimeoutSeconds = if ($env:OPENBUCKET_INSTALL_TIMEOUT) { [int]$env:OPENBUCKET_INSTALL_TIMEOUT } else { 120 }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node.js 22.13 or newer first."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required and was not found on PATH."
}

& node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"
if ($LASTEXITCODE -ne 0) {
  throw "OpenBucket requires Node.js 22.13 or newer; found $(& node --version)."
}

$spec = $Package
if ($Version) {
  $isLocalOrUrl = $Package -match '^(\.|/|[A-Za-z]:[\\/]|https?://)' -or $Package.EndsWith(".tgz")
  if ($isLocalOrUrl) { throw "-Version can only be combined with a registry package name." }
  $spec = "$Package@$Version"
}

$arguments = @(
  "install", "--global", "--no-audit", "--no-fund",
  "--fetch-timeout=30000", "--fetch-retries=1",
  "--fetch-retry-mintimeout=2000", "--fetch-retry-maxtimeout=5000"
)
if ($Prefix) { $arguments += @("--prefix", $Prefix) }
$arguments += $spec

Write-Host "Installing $spec with npm (timeout: ${TimeoutSeconds}s)..."
$previousNodeOptions = $env:NODE_OPTIONS
$env:NODE_OPTIONS = "$previousNodeOptions --dns-result-order=ipv4first".Trim()

function ConvertTo-QuotedArgument([string]$Value) {
  if ($Value -match '[\s"]') { return '"' + ($Value -replace '"', '\"') + '"' }
  return $Value
}

try {
  $commandLine = ($arguments | ForEach-Object { ConvertTo-QuotedArgument $_ }) -join " "
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = "/d /c npm $commandLine"
  $psi.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($psi)

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill($true) } catch {}
    Write-Error "npm install did not finish within ${TimeoutSeconds}s and was aborted."
    Write-Warning "This usually means a broken IPv6 route to the npm registry. Re-run with a longer -TimeoutSeconds, or check that IPv4 connectivity works."
    exit 1
  }
  if ($process.ExitCode -ne 0) { throw "npm install failed with exit code $($process.ExitCode)." }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}

$command = Get-Command openbucket -ErrorAction SilentlyContinue
if ($command) {
  & openbucket version
  Write-Host "Installed successfully. Run: openbucket login --email you@example.com"
  Write-Host "Then serve a disk: openbucket serve C:\path\to\storage --name my-node"
} else {
  Write-Warning "npm completed, but openbucket is not on PATH. Add npm's global bin directory to PATH, then run openbucket version."
}
