@echo off
title Dev Server Reset (clean install, stay-open)

REM Always run from the directory of this script
cd /d "%~dp0"

echo This will remove node_modules and reinstall dependencies.
echo If you have a package-lock.json, it will be removed too.
echo.
echo Press Ctrl+C to cancel, or any key to continue...
pause

echo.
echo Removing node_modules...
IF EXIST "node_modules" (
    rmdir /s /q node_modules
) ELSE (
    echo node_modules not found. Skipping removal.
)

echo Removing package-lock.json (if exists)...
IF EXIST "package-lock.json" (
    del /q package-lock.json
) ELSE (
    echo package-lock.json not found. Skipping.
)

echo.
echo Cleaning npm cache (safe)...
npm cache verify >nul 2>&1
npm cache clean --force

echo.
echo Installing dependencies fresh...
npm install

echo.
echo Ensuring react-router-dom is installed...
npm ls react-router-dom >nul 2>&1 || npm install react-router-dom

echo.
echo Starting dev server (window will stay open)...
cmd /k npm run dev

echo.
echo Dev server exited. Press any key to close this window.
pause >nul