[CmdletBinding()]
param(
  [string]$Package,
  [string]$Version,
  [string]$Prefix,
  [int]$TimeoutSeconds,
  [switch]$SkipNodeInstall,
  [ValidateSet("npm", "pnpm")]
  [string]$PackageManager,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Help) {
  @"
Install OpenBucket: checks/installs Node.js if needed, installs the npm
package globally, then verifies the result.

Usage: ./install.ps1 [-Package SPEC] [-Version VERSION] [-Prefix DIRECTORY] [-TimeoutSeconds N] [-SkipNodeInstall] [-PackageManager npm|pnpm]

Package may be an npm name, tarball URL, .tgz file, or local directory.
Defaults come from OPENBUCKET_NPM_PACKAGE, OPENBUCKET_INSTALL_VERSION, and
OPENBUCKET_NPM_PREFIX. The package name otherwise defaults to openbucket.
-TimeoutSeconds aborts npm install after N seconds (default 120, or
OPENBUCKET_INSTALL_TIMEOUT). -SkipNodeInstall fails instead of attempting to
install Node.js automatically. -PackageManager selects npm or pnpm for the
global install (default: OPENBUCKET_PACKAGE_MANAGER, or an interactive
prompt if both are present and this is an interactive terminal, or
whichever one is found if only one is present).

If Node.js 22.13+ isn't already on PATH, this script tries winget, then
Chocolatey, then Scoop, then falls back to the official prebuilt Node.js
archive from nodejs.org. It does not elevate, open ports, or modify firewall
rules itself; a package manager step may prompt you (e.g. a UAC dialog) on
its own.

This script also checks for cloudflared (Cloudflare's tunnel client), which
is used only by OpenBucket's optional public-tunnel feature; OpenBucket
itself runs fully offline/locally without it. If cloudflared is missing, the
script tries winget, then Chocolatey, then Scoop (the same order as the
Node.js install above).

If the npm install step hangs rather than failing outright, it is almost
always a broken IPv6 route: DNS returns both an A and an AAAA record for the
npm registry, Node.js picks the AAAA record, and that connection attempt
times out slowly before falling back. This script sets
NODE_OPTIONS=--dns-result-order=ipv4first and shortens npm's fetch retry
backoff to fail fast instead of hanging for minutes.
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
if (-not $PackageManager -and $env:OPENBUCKET_PACKAGE_MANAGER) { $PackageManager = $env:OPENBUCKET_PACKAGE_MANAGER }

$RequiredMajor = 22
$RequiredMinor = 13
$NodeDistVersion = if ($env:OPENBUCKET_NODE_DIST_VERSION) { $env:OPENBUCKET_NODE_DIST_VERSION } else { "22.13.0" }
$TotalSteps = 5
$StepNum = 0

function Write-Step([string]$Title) {
  $script:StepNum++
  Write-Host ""
  Write-Host "[$script:StepNum/$TotalSteps] $Title" -ForegroundColor White
}
function Write-Ok([string]$Message) { Write-Host "  * $Message" -ForegroundColor Green }
function Write-Info([string]$Message) { Write-Host "  . $Message" -ForegroundColor DarkGray }
function Write-Warn2([string]$Message) { Write-Host "  ! $Message" -ForegroundColor Yellow }
function Write-Fail([string]$Message) { Write-Host "  x $Message" -ForegroundColor Red }

Write-Host "OpenBucket installer" -ForegroundColor Magenta
Write-Host "Turns a local folder into an S3-compatible endpoint." -ForegroundColor DarkGray

function Test-NodeVersionOk {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
  & node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > $RequiredMajor || (major === $RequiredMajor && minor >= $RequiredMinor) ? 0 : 1)" 2>$null
  return $LASTEXITCODE -eq 0
}

function Install-NodeViaPackageManager {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Info "Found winget; installing Node.js LTS..."
    try {
      winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
      return $true
    } catch { return $false }
  }
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Info "Found Chocolatey; installing Node.js LTS..."
    try {
      choco install nodejs-lts -y | Out-Null
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
      return $true
    } catch { return $false }
  }
  if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Info "Found Scoop; installing Node.js LTS..."
    try {
      scoop install nodejs-lts | Out-Null
      return $true
    } catch { return $false }
  }
  return $false
}

function Install-NodeFromOfficialArchive {
  $arch = if ([System.Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
  } else { "x86" }
  $archiveName = "node-v$NodeDistVersion-win-$arch"
  $url = "https://nodejs.org/dist/v$NodeDistVersion/$archiveName.zip"
  $installRoot = Join-Path $env:USERPROFILE ".openbucket\node"
  New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
  $zipPath = Join-Path $installRoot "$archiveName.zip"

  Write-Info "Downloading Node.js v$NodeDistVersion for win-$arch..."
  try {
    Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing
  } catch {
    Write-Fail "Download failed: $url"
    return $false
  }

  Write-Info "Extracting..."
  $targetDir = Join-Path $installRoot $archiveName
  if (Test-Path $targetDir) { Remove-Item -Recurse -Force $targetDir }
  try {
    Expand-Archive -Path $zipPath -DestinationPath $installRoot -Force
  } catch {
    Write-Fail "Failed to extract Node.js archive."
    return $false
  }
  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  $env:Path = "$targetDir;$env:Path"
  Write-Ok "Node.js v$NodeDistVersion is ready for this session at $targetDir"
  Write-Info "To keep using it in new shells, add this to your PowerShell profile:"
  Write-Info "  `$env:Path = `"$targetDir;`$env:Path`""
  return $true
}

Write-Step "Checking for Node.js $RequiredMajor.$RequiredMinor+"
if (Test-NodeVersionOk) {
  Write-Ok "Node.js $(& node --version) found"
} else {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Warn2 "Found Node.js $(& node --version), but OpenBucket needs $RequiredMajor.$RequiredMinor+"
  } else {
    Write-Warn2 "Node.js was not found on PATH"
  }

  if ($SkipNodeInstall) {
    Write-Fail "Node.js $RequiredMajor.$RequiredMinor+ is required. Install it and re-run this script."
    exit 1
  }

  Write-Info "Attempting to install Node.js automatically..."
  $installed = $false
  if (Install-NodeViaPackageManager) {
    if (Test-NodeVersionOk) { $installed = $true }
  }
  if (-not $installed -and (Install-NodeFromOfficialArchive)) {
    if (Test-NodeVersionOk) { $installed = $true }
  }
  if ($installed) {
    Write-Ok "Node.js $(& node --version) installed"
  } else {
    Write-Fail "Could not install Node.js automatically."
    Write-Fail "Install Node.js $RequiredMajor.$RequiredMinor+ yourself from https://nodejs.org and re-run this script."
    exit 1
  }
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Fail "npm is required and was not found on PATH (it normally ships with Node.js)."
  exit 1
}

function Install-CloudflaredViaPackageManager {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Info "Found winget; installing cloudflared..."
    try {
      winget install --id Cloudflare.cloudflared -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
      return $true
    } catch { return $false }
  }
  if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Info "Found Chocolatey; installing cloudflared..."
    try {
      choco install cloudflared -y | Out-Null
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
      return $true
    } catch { return $false }
  }
  if (Get-Command scoop -ErrorAction SilentlyContinue) {
    Write-Info "Found Scoop; installing cloudflared..."
    try {
      scoop install cloudflared | Out-Null
      return $true
    } catch { return $false }
  }
  return $false
}

Write-Step "Checking for cloudflared (optional; used only for the public tunnel feature)"
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
  $cfVersion = (& cloudflared --version) 2>$null
  Write-Ok "cloudflared found: $cfVersion"
} else {
  Write-Info "cloudflared was not found on PATH; attempting to install it automatically..."
  $cfInstalled = $false
  if (Install-CloudflaredViaPackageManager) {
    if (Get-Command cloudflared -ErrorAction SilentlyContinue) { $cfInstalled = $true }
  }
  if ($cfInstalled) {
    $cfVersion = (& cloudflared --version) 2>$null
    Write-Ok "cloudflared installed: $cfVersion"
  } else {
    Write-Warn2 "Could not install cloudflared automatically (winget/choco/scoop unavailable or the install failed)."
    Write-Warn2 "OpenBucket serve works fully offline/locally without it; cloudflared is only"
    Write-Warn2 "needed for the optional public tunnel feature. Install it manually from:"
    Write-Warn2 "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  }
}

Write-Step "Preparing the OpenBucket package"

$hasNpm = [bool](Get-Command npm -ErrorAction SilentlyContinue)
$hasPnpm = [bool](Get-Command pnpm -ErrorAction SilentlyContinue)

if ($PackageManager) {
  Write-Info "Using package manager: $PackageManager (from -PackageManager/OPENBUCKET_PACKAGE_MANAGER)"
} elseif ($hasNpm -and $hasPnpm) {
  if (-not [System.Console]::IsInputRedirected -and -not [System.Console]::IsOutputRedirected) {
    $pmChoice = Read-Host "Both npm and pnpm are available. Which should install openbucket? [npm/pnpm] (default: npm)"
    if ($pmChoice -eq "pnpm") { $PackageManager = "pnpm" } else { $PackageManager = "npm" }
  } else {
    $PackageManager = "npm"
    Write-Info "Both npm and pnpm are available; defaulting to npm (not an interactive terminal)."
  }
} elseif ($hasPnpm) {
  $PackageManager = "pnpm"
  Write-Info "Using pnpm (npm was not found on PATH)."
} else {
  $PackageManager = "npm"
}
Write-Ok "Package manager: $PackageManager"

$spec = $Package
if ($Version) {
  $isLocalOrUrl = $Package -match '^(\.|/|[A-Za-z]:[\\/]|https?://)' -or $Package.EndsWith(".tgz")
  if ($isLocalOrUrl) { throw "-Version can only be combined with a registry package name." }
  $spec = "$Package@$Version"
}
Write-Ok "Will install: $spec"

Write-Step "Installing OpenBucket with $PackageManager"

if ($PackageManager -eq "pnpm") {
  $arguments = @("add", "--global")
  if ($Prefix) { $arguments += @("--global-dir", $Prefix) }
  $arguments += $spec
} else {
  $arguments = @(
    "install", "--global", "--no-audit", "--no-fund",
    "--fetch-timeout=30000", "--fetch-retries=1",
    "--fetch-retry-mintimeout=2000", "--fetch-retry-maxtimeout=5000"
  )
  if ($Prefix) { $arguments += @("--prefix", $Prefix) }
  $arguments += $spec
}

Write-Info "Running $PackageManager (timeout: ${TimeoutSeconds}s)..."
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
  $psi.Arguments = "/d /c $PackageManager $commandLine"
  $psi.UseShellExecute = $false
  $process = [System.Diagnostics.Process]::Start($psi)

  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill($true) } catch {}
    Write-Fail "$PackageManager install did not finish within ${TimeoutSeconds}s and was aborted."
    Write-Fail "This usually means a broken IPv6 route to the npm registry. Re-run with a longer -TimeoutSeconds, or check that IPv4 connectivity works."
    exit 1
  }
  if ($process.ExitCode -ne 0) { throw "$PackageManager install failed with exit code $($process.ExitCode)." }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}
Write-Ok "$PackageManager install finished"

Write-Step "Verifying the installation"

$command = Get-Command openbucket -ErrorAction SilentlyContinue
if (-not $command) {
  Write-Fail "$PackageManager completed, but openbucket is not on PATH."
  Write-Fail "Add $PackageManager's global bin directory to PATH, then run: openbucket version"
  exit 1
}

$installedVersion = (& openbucket version) -replace '^openbucket\s+', ''
Write-Ok "openbucket $installedVersion is on PATH"

$doctorOutput = & openbucket doctor 2>&1
$doctorExit = $LASTEXITCODE
if ($doctorExit -eq 0) {
  Write-Ok "openbucket doctor passed"
} else {
  Write-Warn2 "openbucket doctor reported issues (this is expected before your first 'serve')"
}
$doctorOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "Done. OpenBucket $installedVersion is installed." -ForegroundColor Green
Write-Host ""
Write-Host "  openbucket login --email you@example.com" -ForegroundColor White
Write-Host "  openbucket serve C:\path\to\storage --name my-node" -ForegroundColor White
Write-Host ""
