@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Build and prepare host-friendly deploy folder (host-deploy/)
REM Also ensures PHP dependencies for backend (vendor/ with PHPMailer, Dotenv, etc.)
REM Usage: double-click or run from cmd: run-prepare-host-deploy.cmd

set ROOT=%~dp0
set PHP_BACKEND=%ROOT%php-backend
set COMPOSER_PHAR=%PHP_BACKEND%\composer.phar

echo [setup] Verifying prerequisites...

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo [error] Node.js is required. Install from https://nodejs.org
  exit /b 1
)

where php >nul 2>&1
if %errorlevel% neq 0 (
  echo [error] PHP is required for installing backend dependencies. Install PHP 8.1+ and ensure php.exe is on PATH.
  exit /b 1
)

REM Ensure Composer is available (prefer local composer.phar; fallback to system composer; else download)
set USE_COMPOSER_PHAR=0
if exist "%COMPOSER_PHAR%" (
  set USE_COMPOSER_PHAR=1
) else (
  where composer >nul 2>&1
  if %errorlevel% neq 0 (
    echo [setup] composer.phar not found. Downloading Composer to php-backend\composer.phar ...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      "try { ^
        $dst = '%COMPOSER_PHAR%'; ^
        $dir = Split-Path -Parent $dst; ^
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null } ^
        Invoke-WebRequest -UseBasicParsing -Uri https://getcomposer.org/composer-stable.phar -OutFile $dst; ^
        exit 0 ^
      } catch { ^
        Write-Host 'Failed to download composer.phar:' $_.Exception.Message; ^
        exit 1 ^
      }"
    if %errorlevel% neq 0 (
      echo [error] Failed to download Composer. Install Composer or place composer.phar in php-backend\ then retry.
      exit /b 1
    )
    set USE_COMPOSER_PHAR=1
  )
)

echo [setup] Installing PHP dependencies (vendor/) for backend...
pushd "%PHP_BACKEND%"
if %USE_COMPOSER_PHAR%==1 (
  php "%COMPOSER_PHAR%" install --no-dev --prefer-dist --no-interaction
) else (
  composer install --no-dev --prefer-dist --no-interaction
)
if %errorlevel% neq 0 (
  echo [error] Composer install failed. Please check PHP/OpenSSL/Internet connectivity and retry.
  popd
  exit /b %errorlevel%
)
popd

echo [setup] PHP dependencies installed.

echo [build] Building frontend and preparing host-deploy...
node "%ROOT%scripts\prepare-host-deploy.js"
if %errorlevel% neq 0 (
  echo [error] Failed to prepare host deploy.
  exit /b %errorlevel%
)

echo.
echo Host deploy prepared in host-deploy\
echo - Frontend build copied
echo - Backend copied to host-deploy\api with vendor\
echo Upload all files inside host-deploy\ to your hosting public_html.
echo.
endlocal