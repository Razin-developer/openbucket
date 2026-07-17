#!/usr/bin/env sh
set -eu

package=${OPENBUCKET_NPM_PACKAGE:-openbucket}
version=${OPENBUCKET_INSTALL_VERSION:-}
prefix=${OPENBUCKET_NPM_PREFIX:-}

usage() {
  cat <<'EOF'
Install OpenBucket's npm package globally.

Usage: install.sh [--package SPEC] [--version VERSION] [--prefix DIRECTORY]

  --package SPEC   npm name, tarball URL, .tgz file, or local directory
                   (default: OPENBUCKET_NPM_PACKAGE or openbucket)
  --version VALUE  registry version/tag (default: OPENBUCKET_INSTALL_VERSION)
  --prefix DIR     npm global prefix (default: OPENBUCKET_NPM_PREFIX/npm config)
  -h, --help       show this help

The script does not use sudo, install an OS service, change PATH, open ports, or
modify firewall rules. It installs the selected package through npm only.
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

command -v node >/dev/null 2>&1 || {
  echo "Node.js is required. Install Node.js 22.13 or newer first." >&2
  exit 1
}
command -v npm >/dev/null 2>&1 || {
  echo "npm is required and was not found on PATH." >&2
  exit 1
}

if ! node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)"; then
  echo "OpenBucket requires Node.js 22.13 or newer; found $(node --version)." >&2
  exit 1
fi

spec=$package
if [ -n "$version" ]; then
  case "$package" in
    ./*|../*|/*|*.tgz|http://*|https://*)
      echo "--version can only be combined with a registry package name." >&2
      exit 2
      ;;
    *) spec="${package}@${version}" ;;
  esac
fi

echo "Installing $spec with npm..."
if [ -n "$prefix" ]; then
  npm install --global --prefix "$prefix" "$spec"
else
  npm install --global "$spec"
fi

if command -v openbucket >/dev/null 2>&1; then
  openbucket version
  echo "Installed successfully. Run: openbucket login --email you@example.com"
  echo "Then serve a disk: openbucket serve /path/to/storage --name my-node"
else
  echo "npm completed, but openbucket is not on PATH." >&2
  if [ -n "$prefix" ]; then
    echo "Add the npm bin directory under $prefix to PATH." >&2
  else
    echo "Add npm's global bin directory to PATH, then run: openbucket version" >&2
  fi
fi
