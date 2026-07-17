[CmdletBinding()]
param(
  [string]$Package,
  [string]$Version,
  [string]$Prefix,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Install OpenBucket's npm package globally.

Usage: ./install.ps1 [-Package SPEC] [-Version VERSION] [-Prefix DIRECTORY]

Package may be an npm name, tarball URL, .tgz file, or local directory.
Defaults come from OPENBUCKET_NPM_PACKAGE, OPENBUCKET_INSTALL_VERSION, and
OPENBUCKET_NPM_PREFIX. The package name otherwise defaults to openbucket.

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

$arguments = @("install", "--global")
if ($Prefix) { $arguments += @("--prefix", $Prefix) }
$arguments += $spec

Write-Host "Installing $spec with npm..."
& npm @arguments
if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }

$command = Get-Command openbucket -ErrorAction SilentlyContinue
if ($command) {
  & openbucket version
  Write-Host "Installed successfully. Run: openbucket login --email you@example.com"
  Write-Host "Then serve a disk: openbucket serve C:\path\to\storage --name my-node"
} else {
  Write-Warning "npm completed, but openbucket is not on PATH. Add npm's global bin directory to PATH, then run openbucket version."
}
