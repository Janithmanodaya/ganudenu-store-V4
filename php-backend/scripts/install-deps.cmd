@echo off
rem Wrapper to run the PowerShell dependency installer for the PHP backend
setlocal

set SCRIPT_DIR=%~dp0
set PS1=%SCRIPT_DIR%install-deps.ps1

if not exist "%PS1%" (
  echo [ERROR] PowerShell script not found: %PS1%
  exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%PS1%" %*

endlocal