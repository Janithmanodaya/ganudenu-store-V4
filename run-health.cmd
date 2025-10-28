@echo off
REM One-click PHP backend health check runner (Windows CMD)
REM Usage: run-health.cmd [https://your-domain.com]
SETLOCAL ENABLEDELAYEDEXPANSION

REM Determine TARGET from arg or env
set "TARGET_ARG=%~1"
if not "%TARGET_ARG%"=="" (
  set "TARGET=%TARGET_ARG%"
) else (
  if "%TARGET%"=="" (
    set "TARGET=http://localhost"
  )
)

REM Prepare report directory and file
set "REPORT_DIR=data\health-reports"
if not exist "%REPORT_DIR%" (
  mkdir "%REPORT_DIR%"
)

for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('yyyyMMdd_HHmmss')"') do set "TS=%%i"
set "REPORT_FILE=%REPORT_DIR%\health_!TS!.txt"

echo Health check started at !DATE! !TIME! > "!REPORT_FILE!"
echo Target: %TARGET%>> "!REPORT_FILE!"
echo Report file: "!REPORT_FILE!"
echo.

REM Verify npm is available
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm is not available on PATH.>> "!REPORT_FILE!"
  echo Please install Node.js and ensure npm is on PATH.>> "!REPORT_FILE!"
  echo RESULT: FAIL (exit code 1)>> "!REPORT_FILE!"
  echo RESULT: FAIL (exit code 1)
  ENDLOCAL
  exit /b 1
)

echo Installing dependencies...
REM Capture output to file (UTF-8) and also echo to console
powershell -NoProfile -Command "npm install 2>&1 ^| ForEach-Object { $_; $_ ^| Out-File -FilePath '%REPORT_FILE%' -Append -Encoding utf8 }; exit $LASTEXITCODE"
set "NPM_INSTALL_CODE=%ERRORLEVEL%"
if not "!NPM_INSTALL_CODE!"=="0" (
  echo npm install exited with code !NPM_INSTALL_CODE!>> "!REPORT_FILE!"
  echo.>> "!REPORT_FILE!"
  echo RESULT: FAIL (exit code !NPM_INSTALL_CODE!)>> "!REPORT_FILE!"
  echo RESULT: FAIL (exit code !NPM_INSTALL_CODE!)
  ENDLOCAL
  exit /b !NPM_INSTALL_CODE!
)

echo.>> "!REPORT_FILE!"
echo Running PHP backend health checks against %TARGET%...
echo Running PHP backend health checks against %TARGET%...>> "!REPORT_FILE!"
REM Pass TARGET via env to npm script
powershell -NoProfile -Command "$env:TARGET='%TARGET%'; npm run health:php 2>&1 ^| ForEach-Object { $_; $_ ^| Out-File -FilePath '%REPORT_FILE%' -Append -Encoding utf8 }; exit $LASTEXITCODE"
set "TEST_EXIT_CODE=%ERRORLEVEL%"

echo.>> "!REPORT_FILE!"
if "!TEST_EXIT_CODE!"=="0" (
  echo RESULT: PASS>> "!REPORT_FILE!"
  echo RESULT: PASS
) else (
  echo RESULT: FAIL (exit code !TEST_EXIT_CODE!)>> "!REPORT_FILE!"
  echo RESULT: FAIL (exit code !TEST_EXIT_CODE!)
)

echo Completed at !DATE! !TIME!>> "!REPORT_FILE!"
ENDLOCAL

REM Propagate the test exit code to the caller
exit /b %TEST_EXIT_CODE%