#!/usr/bin/env bash
set -euo pipefail

# Build and prepare host-friendly deploy folder (host-deploy/)
# Usage: ./prepare-host-deploy.sh
# This script targets PHP-only shared hosts by:
# - Copying the built frontend (dist/) to host-deploy/
# - Copying PHP backend into host-deploy/api/
# - Writing .env with production-safe defaults
# - Writing .htaccess for Apache; for hosts without .htaccess support, the frontend polyfill will route via /api/index.php

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install from https://nodejs.org"
  exit 1
fi

# Ensure we output backend to 'api' and set the public API route
export BACKEND_DIR=api
export PUBLIC_API_ROUTE=/api

node "$(dirname "$0")/scripts/prepare-host-deploy.js"

echo
echo "Host deploy prepared in host-deploy/"
echo "- Frontend build copied (assets/ + manifest.json)"
echo "- Backend copied to host-deploy/api (index.php + app/ + config/ + .env + var/ + var/uploads/)"
echo "Upload ALL files inside host-deploy/ to your hosting public_html."
echo "Ensure api/var and api/var/uploads are writable by the web server (chmod 775 or 755)."
echo