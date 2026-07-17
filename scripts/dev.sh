#!/usr/bin/env sh
set -eu

storage_root=${1:-./.openbucket-data}
started=0

cleanup() {
  if [ "$started" -eq 1 ]; then
    npm run openbucket -- stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

export OPENBUCKET_SERVE_DASHBOARD=false
export OPENBUCKET_DASHBOARD_URL=${OPENBUCKET_DASHBOARD_URL:-http://localhost:3000}
export OPENBUCKET_OPEN_DASHBOARD=false

echo "Starting OpenBucket daemon on $storage_root..."
npm run openbucket -- serve "$storage_root" --offline --no-tunnel --detach --no-open
started=1

echo "Starting dashboard development server..."
echo "Run 'npm run openbucket -- dashboard' in another terminal to pair and open it securely."
echo "After it is listening, run 'npm run openbucket -- dashboard' in another terminal to pair it."
echo "The daemon will be stopped when this script exits normally."
npm run dev
