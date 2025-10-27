# Run Dev Server (PowerShell) - starts PHP backend and Vite frontend, stays open and shows full logs

# Always run from the directory of this script
Set-Location -LiteralPath $PSScriptRoot

Write-Host "Checking PHP and npm..."
$phpVersion = php -v 2>$null
$npmVersion = npm -v 2>$null

if (-not $phpVersion) {
  Write-Host "ERROR: PHP not found in PATH. Install PHP 8.1+ and ensure 'php' is on PATH."
  Read-Host "Press Enter to close"
  exit 1
}
if (-not $npmVersion) {
  Write-Host "ERROR: npm not found in PATH. Install Node.js (for Vite) from https://nodejs.org"
  Read-Host "Press Enter to close"
  exit 1
}

Write-Host "PHP:`n$phpVersion"
Write-Host "npm: $npmVersion"

# Install frontend dependencies if missing
if (-not (Test-Path "node_modules")) {
  Write-Host "node_modules not found. Installing dependencies..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install failed (exit code $LASTEXITCODE)"
    Read-Host "Press Enter to close"
    exit $LASTEXITCODE
  }
}

# Ensure react-router-dom is installed
Write-Host ""
Write-Host "Verifying react-router-dom is installed..."
npm ls react-router-dom | Out-Null
if ($LASTEXITCODE -ne 0) {
  Write-Host "react-router-dom not found. Installing..."
  npm install react-router-dom
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install react-router-dom (exit code $LASTEXITCODE)"
    Read-Host "Press Enter to close"
    exit $LASTEXITCODE
  }
}

# Prepare PHP backend env and data directories
Write-Host ""
Write-Host "Preparing PHP backend environment..."
$envFile = Join-Path $PSScriptRoot "php-backend\.env"
$envExample = Join-Path $PSScriptRoot "php-backend\.env.example"
if (-not (Test-Path $envFile)) {
  if (Test-Path $envExample) {
    Write-Host "php-backend/.env not found. Copying from .env.example..."
    Copy-Item -LiteralPath $envExample -Destination $envFile -Force
  } else {
    Write-Host "WARNING: php-backend/.env not found and no .env.example to copy. Backend may fail without configuration."
  }
}

# Ensure data directories exist
$uploadsDir = Join-Path $PSScriptRoot "data\uploads"
$tmpAiDir = Join-Path $PSScriptRoot "data\tmp_ai"
if (-not (Test-Path $uploadsDir)) { New-Item -ItemType Directory -Path $uploadsDir | Out-Null }
if (-not (Test-Path $tmpAiDir)) { New-Item -ItemType Directory -Path $tmpAiDir | Out-Null }

# Install PHP backend packages (Composer) before migrations
Write-Host ""
Write-Host "Installing PHP backend dependencies..."
$installDepsScript = Join-Path $PSScriptRoot "php-backend\scripts\install-deps-fixed.ps1"
if (Test-Path $installDepsScript) {
  & $installDepsScript
  if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: PHP dependency installation exited with code $LASTEXITCODE. Proceeding may fail."
  }
} else {
  Write-Host "WARNING: install-deps-fixed.ps1 not found at $installDepsScript"
}

# Run migrations (safe to run multiple times)
Write-Host "Running PHP migrations..."
php "php-backend\scripts\migrate.php"
if ($LASTEXITCODE -ne 0) {
  Write-Host "WARNING: Migrations exited with code $LASTEXITCODE. Ensure php-backend/.env is configured."
}

# Start PHP backend server
Write-Host ""
Write-Host "Starting PHP backend at http://localhost:5174 ..."
Start-Process -FilePath "php" -ArgumentList "-S 0.0.0.0:5174 -t php-backend/public" -WorkingDirectory $PSScriptRoot -WindowStyle Normal | Out-Null

Write-Host ""
Write-Host "Starting Vite dev server (host enabled) at http://localhost:5173 ..."
Write-Host "Press Ctrl+C to stop the frontend server in this window."
Write-Host ""

# Run Vite dev server and keep PowerShell open
npm run dev -- --host
Write-Host ""
Write-Host "Frontend dev server exited with code: $LASTEXITCODE"
Read-Host "Press Enter to close"