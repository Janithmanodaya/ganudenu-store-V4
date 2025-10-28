@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Build and prepare host-friendly deploy folder (host-deploy/)
REM Also runs php-backend\scripts\install-deps-fixed.ps1 to install PHP libraries (PHPMailer, Dotenv, etc.)
REM Usage: double-click or run from cmd: run-prepare-host-deploy.cmd

set ROOT=%~dp0

echo [setup] Verifying prerequisites...

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [error] Node.js is required. Install from https://nodejs.org
  exit /b 1
)

where powershell >nul 2>&1
if %errorlevel% neq 0 (
  echo [error] PowerShell is required. Please run on Windows with PowerShell available.
  exit /b 1
)

REM Install backend PHP deps using your dedicated script
echo [deps] Installing PHP libraries via php-backend\scripts\install-deps-fixed.ps1 ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%php-backend\scripts\install-deps-fixed.ps1"
if %errorlevel% neq 0 (
  echo [error] Dependency installation failed. Check output above.
  exit /b %errorlevel%
)

echo [build] Building frontend and preparing host-deploy...
REM Use 'api' as backend output folder to avoid relying on .htaccess rewrites.
REM This creates host-deploy\api\index.php so /api/index.php works on any host.
set BACKEND_DIR=api
set PUBLIC_API_ROUTE=/api
echo [config] Using backend output folder: %BACKEND_DIR% (PUBLIC_API_ROUTE=%PUBLIC_API_ROUTE%)
node "%ROOT%scripts\prepare-host-deploy.js"
if %errorlevel% neq 0 (
  echo [error] Failed to prepare host deploy.
  exit /b %errorlevel%
)

echo.
echo Host deploy prepared in host-deploy\
echo - Frontend build copied (assets\ + manifest.json)
echo - Backend copied to host-deploy\%BACKEND_DIR% (vendor\ included if installed)
echo Upload ALL files inside host-deploy\ to your hosting public_html.
echo Ensure %BACKEND_DIR%\var and %BACKEND_DIR%\var\uploads are writable (755/775).
echo.
endlocal