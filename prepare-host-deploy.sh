#!/usr/bin/env bash
set -euo pipefail

# Build and prepare host-friendly deploy folder (host-deploy/)
# Usage: ./prepare-host-deploy.sh

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install from https://nodejs.org"
  exit 1
fi

node "$(dirname "$0")/scripts/prepare-host-deploy.js"

echo
echo "Host deploy prepared in host-deploy/"
echo "Upload all files inside host-deploy/ to your hosting public_html."
echo