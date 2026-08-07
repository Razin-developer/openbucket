#!/usr/bin/env sh
set -eu

package=${OPENBUCKET_NPM_PACKAGE:-openbucket}
version=${OPENBUCKET_INSTALL_VERSION:-}
prefix=${OPENBUCKET_NPM_PREFIX:-}
timeout_seconds=${OPENBUCKET_INSTALL_TIMEOUT:-120}
required_major=22
required_minor=13
node_dist_version=${OPENBUCKET_NODE_DIST_VERSION:-22.13.0}
skip_node_install=0
total_steps=4

usage() {
  cat <<'EOF'
Install OpenBucket: checks/installs Node.js if needed, installs the npm
package globally, then verifies the result.

Usage: install.sh [--package SPEC] [--version VERSION] [--prefix DIRECTORY]

  --package SPEC        npm name, tarball URL, .tgz file, or local directory
                         (default: OPENBUCKET_NPM_PACKAGE or openbucket)
  --version VALUE       registry version/tag (default: OPENBUCKET_INSTALL_VERSION)
  --prefix DIR           npm global prefix (default: OPENBUCKET_NPM_PREFIX/npm config)
  --timeout SECS         abort npm install after SECS seconds (default: 120, or
                         OPENBUCKET_INSTALL_TIMEOUT)
  --skip-node-install    fail instead of attempting to install Node.js
  -h, --help             show this help

If Node.js 22.13+ isn't already on PATH, this script tries the platform's own
package manager first (brew, apt, dnf, pacman, apk), then falls back to the
official prebuilt Node.js archive from nodejs.org. It never uses sudo itself;
if a package manager step needs elevated privileges you will be prompted by
that tool directly, not by this script.

If the npm install step hangs rather than failing outright, it is almost
always a broken IPv6 route: DNS returns both an A and an AAAA record for the
npm registry, Node.js picks the AAAA record, and that connection attempt
times out slowly before falling back. This script sets
NODE_OPTIONS=--dns-result-order=ipv4first and shortens npm's fetch retry
backoff to fail fast instead of hanging for minutes.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --package)
      [ "$#" -ge 2 ] || { echo "--package requires a value" >&2; exit 2; }
      package=$2
      shift 2
      ;;
    --version)
      [ "$#" -ge 2 ] || { echo "--version requires a value" >&2; exit 2; }
      version=$2
      shift 2
      ;;
    --prefix)
      [ "$#" -ge 2 ] || { echo "--prefix requires a value" >&2; exit 2; }
      prefix=$2
      shift 2
      ;;
    --timeout)
      [ "$#" -ge 2 ] || { echo "--timeout requires a value" >&2; exit 2; }
      timeout_seconds=$2
      shift 2
      ;;
    --skip-node-install)
      skip_node_install=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Presentation helpers
# ---------------------------------------------------------------------------

if [ -t 1 ]; then
  c_reset="$(printf '\033[0m')"; c_bold="$(printf '\033[1m')"; c_dim="$(printf '\033[2m')"
  c_green="$(printf '\033[32m')"; c_red="$(printf '\033[31m')"; c_yellow="$(printf '\033[33m')"
  c_blue="$(printf '\033[34m')"; c_magenta="$(printf '\033[35m')"
else
  c_reset=""; c_bold=""; c_dim=""; c_green=""; c_red=""; c_yellow=""; c_blue=""; c_magenta=""
fi

step_num=0
step() {
  step_num=$((step_num + 1))
  printf '\n%s[%s/%s]%s %s%s%s\n' "$c_bold" "$step_num" "$total_steps" "$c_reset" "$c_bold" "$1" "$c_reset"
}
ok()   { printf '  %s✓%s %s\n' "$c_green" "$c_reset" "$1"; }
info() { printf '  %s·%s %s\n' "$c_dim" "$c_reset" "$1"; }
warn() { printf '  %s!%s %s\n' "$c_yellow" "$c_reset" "$1"; }
fail() { printf '  %s✗%s %s\n' "$c_red" "$c_reset" "$1" >&2; }

printf '%s%s\n' "$c_magenta$c_bold" "OpenBucket installer"
printf '%s%s\n' "$c_dim" "Turns a local folder into an S3-compatible endpoint.$c_reset"

# ---------------------------------------------------------------------------
# Step 1: Node.js
# ---------------------------------------------------------------------------

node_version_ok() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > ${required_major} || (major === ${required_major} && minor >= ${required_minor}) ? 0 : 1)" 2>/dev/null
}

install_node_via_package_manager() {
  if command -v brew >/dev/null 2>&1; then
    info "Found Homebrew; installing Node.js LTS..."
    brew install node@22 >/dev/null 2>&1 && brew link --overwrite --force node@22 >/dev/null 2>&1 && return 0
    brew install node >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v apt-get >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    info "Found apt; installing Node.js via NodeSource (may prompt for a password)..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1 || return 1
    sudo apt-get install -y nodejs >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v dnf >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
    info "Found dnf; installing Node.js via NodeSource (may prompt for a password)..."
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo -E bash - >/dev/null 2>&1 || return 1
    sudo dnf install -y nodejs >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v pacman >/dev/null 2>&1; then
    info "Found pacman; installing Node.js (may prompt for a password)..."
    sudo pacman -Sy --noconfirm nodejs npm >/dev/null 2>&1 && return 0
    return 1
  fi
  if command -v apk >/dev/null 2>&1; then
    info "Found apk; installing Node.js..."
    sudo apk add --no-cache nodejs npm >/dev/null 2>&1 && return 0
    return 1
  fi
  return 1
}

install_node_from_official_archive() {
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) platform="darwin" ;;
    Linux) platform="linux" ;;
    *) fail "No official prebuilt Node.js archive for OS: $os"; return 1 ;;
  esac
  case "$arch" in
    x86_64|amd64) node_arch="x64" ;;
    arm64|aarch64) node_arch="arm64" ;;
    *) fail "No official prebuilt Node.js archive for architecture: $arch"; return 1 ;;
  esac

  archive="node-v${node_dist_version}-${platform}-${node_arch}"
  url="https://nodejs.org/dist/v${node_dist_version}/${archive}.tar.gz"
  install_root="${HOME}/.openbucket/node"
  info "Downloading Node.js v${node_dist_version} for ${platform}-${node_arch}..."

  mkdir -p "$install_root"
  tmp_tar="$(mktemp 2>/dev/null || echo "/tmp/openbucket-node-$$.tar.gz")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp_tar" || { fail "Download failed: $url"; return 1; }
  elif command -v wget >/dev/null 2>&1; then
    wget -q "$url" -O "$tmp_tar" || { fail "Download failed: $url"; return 1; }
  else
    fail "Neither curl nor wget is available to download Node.js."
    return 1
  fi

  info "Extracting..."
  rm -rf "${install_root:?}/${archive}"
  tar -xzf "$tmp_tar" -C "$install_root" || { fail "Failed to extract Node.js archive."; return 1; }
  rm -f "$tmp_tar"

  export PATH="${install_root}/${archive}/bin:${PATH}"
  ok "Node.js v${node_dist_version} is ready for this session at ${install_root}/${archive}/bin"
  info "To keep using it in new shells, add this to your shell profile:"
  info "  export PATH=\"${install_root}/${archive}/bin:\$PATH\""
  return 0
}

step "Checking for Node.js ${required_major}.${required_minor}+"
if node_version_ok; then
  ok "Node.js $(node --version) found"
else
  if command -v node >/dev/null 2>&1; then
    warn "Found Node.js $(node --version), but OpenBucket needs ${required_major}.${required_minor}+"
  else
    warn "Node.js was not found on PATH"
  fi

  if [ "$skip_node_install" -eq 1 ]; then
    fail "Node.js ${required_major}.${required_minor}+ is required. Install it and re-run this script."
    exit 1
  fi

  info "Attempting to install Node.js automatically..."
  if install_node_via_package_manager && node_version_ok; then
    ok "Node.js $(node --version) installed"
  elif install_node_from_official_archive && node_version_ok; then
    ok "Node.js $(node --version) installed"
  else
    fail "Could not install Node.js automatically."
    fail "Install Node.js ${required_major}.${required_minor}+ yourself from https://nodejs.org and re-run this script."
    exit 1
  fi
fi

command -v npm >/dev/null 2>&1 || {
  fail "npm is required and was not found on PATH (it normally ships with Node.js)."
  exit 1
}

# ---------------------------------------------------------------------------
# Step 2: Resolve what to install
# ---------------------------------------------------------------------------

step "Preparing the OpenBucket package"

spec=$package
if [ -n "$version" ]; then
  case "$package" in
    ./*|../*|/*|*.tgz|http://*|https://*)
      fail "--version can only be combined with a registry package name."
      exit 2
      ;;
    *) spec="${package}@${version}" ;;
  esac
fi
ok "Will install: $spec"

# ---------------------------------------------------------------------------
# Step 3: npm install
# ---------------------------------------------------------------------------

step "Installing OpenBucket with npm"

npm_args="install --global --no-audit --no-fund --fetch-timeout=30000 --fetch-retries=1 --fetch-retry-mintimeout=2000 --fetch-retry-maxtimeout=5000"
if [ -n "$prefix" ]; then
  npm_args="$npm_args --prefix $prefix"
fi
npm_args="$npm_args $spec"

info "Running npm (timeout: ${timeout_seconds}s)..."
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"

if command -v timeout >/dev/null 2>&1; then
  runner="timeout ${timeout_seconds}s"
elif command -v gtimeout >/dev/null 2>&1; then
  runner="gtimeout ${timeout_seconds}s"
else
  runner=""
fi

# shellcheck disable=SC2086
if [ -n "$runner" ]; then
  if ! $runner npm $npm_args; then
    status=$?
    if [ "$status" -eq 124 ]; then
      fail "npm install did not finish within ${timeout_seconds}s and was aborted."
      fail "This usually means a broken IPv6 route to the npm registry. Re-run with a"
      fail "longer budget (--timeout 300) or check that IPv4 connectivity works."
    fi
    exit "$status"
  fi
else
  npm $npm_args
fi
ok "npm install finished"

# ---------------------------------------------------------------------------
# Step 4: Verify
# ---------------------------------------------------------------------------

step "Verifying the installation"

if ! command -v openbucket >/dev/null 2>&1; then
  fail "npm completed, but openbucket is not on PATH."
  if [ -n "$prefix" ]; then
    fail "Add the npm bin directory under $prefix to PATH, then run: openbucket version"
  else
    fail "Add npm's global bin directory to PATH, then run: openbucket version"
  fi
  exit 1
fi

installed_version="$(openbucket version 2>/dev/null || echo unknown)"
installed_version="${installed_version#openbucket }"
ok "openbucket $installed_version is on PATH"

if openbucket doctor >/tmp/openbucket-doctor.$$ 2>&1; then
  ok "openbucket doctor passed"
else
  warn "openbucket doctor reported issues (this is expected before your first 'serve')"
fi
sed 's/^/  /' /tmp/openbucket-doctor.$$ 2>/dev/null || true
rm -f /tmp/openbucket-doctor.$$

printf '\n%s%sDone.%s OpenBucket %s is installed.\n\n' "$c_green" "$c_bold" "$c_reset" "$installed_version"
printf '  %sopenbucket login --email you@example.com%s\n' "$c_bold" "$c_reset"
printf '  %sopenbucket serve /path/to/storage --name my-node%s\n\n' "$c_bold" "$c_reset"
