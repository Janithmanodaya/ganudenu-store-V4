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

REM Preserve same API path and env: if api\.env exists at project root, copy it into host-deploy\api\.env.
REM The prepare script will honor DEPLOY_USE_EXISTING_ENV=1 by copying api\.env or php-backend\.env instead of generating defaults.
set DEPLOY_USE_EXISTING_ENV=1

REM Optionally set the public origin (domain) for generated env fallback
REM set DEPLOY_PUBLIC_ORIGIN=https://ganudenu.store

node "%ROOT%scripts\prepare-host-deploy.js"
if %errorlevel% neq 0 (
  echo [error] Failed to prepare host deploy.
  exit /b %errorlevel%
)

echo.
echo Host deploy prepared in host-deploy\
echo - Frontend build copied
echo - Backend copied to host-deploy\api (vendor\ included if installed)
echo - Existing env preserved to host-deploy\api\.env (if found); otherwise a safe default was generated.
echo Upload all files inside host-deploy\ to your hosting public_html.
echo.
endlocal