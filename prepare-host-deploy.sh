#!/usr/bin/env bash
set -euo pipefail

# Build and prepare host-friendly deploy folder (host-deploy/)
# Usage: ./prepare-host-deploy.sh

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install from https://nodejs.org"
  exit 1
fi

# Preserve same API path and env: if api/.env exists at project root, copy it into host-deploy/api/.env.
# The prepare script will honor DEPLOY_USE_EXISTING_ENV=1 by copying api/.env or php-backend/.env instead of generating defaults.
export DEPLOY_USE_EXISTING_ENV=1

# Optionally set the public origin (domain) for generated env fallback
# export DEPLOY_PUBLIC_ORIGIN="https://ganudenu.store"

node "$(dirname "$0")/scripts/prepare-host-deploy.js"

echo
echo "Host deploy prepared in host-deploy/"
echo "- Backend copied to host-deploy/api (vendor/ included if installed)"
echo "- Existing env preserved to host-deploy/api/.env (if found); otherwise a safe default was generated."
echo "Upload all files inside host-deploy/ to your hosting public_html."
echo