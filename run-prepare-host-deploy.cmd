@echo off
setlocal

REM Build and prepare host-friendly deploy folder (host-deploy/)
REM Usage: double-click or run from cmd: run-prepare-host-deploy.cmd

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo Node.js is required to run this script. Please install Node.js from https://nodejs.org
  exit /b 1
)

node "%~dp0scripts\prepare-host-deploy.js"
if %errorlevel% neq 0 (
  echo Failed to prepare host deploy.
  exit /b %errorlevel%
)

echo.
echo Host deploy prepared in host-deploy\
echo Upload all files inside host-deploy\ to your hosting public_html.
echo.
endlocal