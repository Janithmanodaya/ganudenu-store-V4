# One-click health check runner (PowerShell)
param(
  [switch]$SkipInstall
)

Write-Host "Health check runner (PowerShell)" -ForegroundColor Cyan

# Prepare report directory and file
$reportDir = "data/health-reports"
if (-not (Test-Path $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir | Out-Null
}
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$reportFile = Join-Path $reportDir "health_$ts.txt"

"Health check started at $(Get-Date)" | Out-File -FilePath $reportFile -Encoding utf8

# Verify npm is available
$npmPath = (Get-Command npm -ErrorAction SilentlyContinue).Path
if (-not $npmPath) {
  "ERROR: npm is not available on PATH." | Out-File -FilePath $reportFile -Append -Encoding utf8
  "Please install Node.js and ensure npm is on PATH." | Out-File -FilePath $reportFile -Append -Encoding utf8
  Write-Host "ERROR: npm is not available on PATH." -ForegroundColor Red
  "RESULT: FAIL (exit code 1)" | Out-File -FilePath $reportFile -Append -Encoding utf8
  exit 1
}

if (-not $SkipInstall) {
  Write-Host "Installing dependencies..." -ForegroundColor Yellow
  # Echo each line to console and append to UTF-8 report
  & $npmPath install 2>&1 | ForEach-Object {
    $_
    $_ | Out-File -FilePath $reportFile -Append -Encoding utf8
  }
  $npmInstallCode = $LASTEXITCODE
  if ($npmInstallCode -ne 0) {
    "npm install exited with code $npmInstallCode" | Out-File -FilePath $reportFile -Append -Encoding utf8
    "RESULT: FAIL (exit code $npmInstallCode)" | Out-File -FilePath $reportFile -Append -Encoding utf8
    exit $npmInstallCode
  }
} else {
  Write-Host "Skipping npm install..." -ForegroundColor Yellow
  "Skipping npm install..." | Out-File -FilePath $reportFile -Append -Encoding utf8
}

Write-Host "Running full health checks (public + authenticated)..." -ForegroundColor Green
"Running full health checks (public + authenticated)..." | Out-File -FilePath $reportFile -Append -Encoding utf8

& $npmPath run health:full 2>&1 | ForEach-Object {
  $_
  $_ | Out-File -FilePath $reportFile -Append -Encoding utf8
}
$testExitCode = $LASTEXITCODE

"`n" | Out-File -FilePath $reportFile -Append -Encoding utf8
if ($testExitCode -eq 0) {
  "RESULT: PASS" | Out-File -FilePath $reportFile -Append -Encoding utf8
  Write-Host "RESULT: PASS" -ForegroundColor Green
} else {
  "RESULT: FAIL (exit code $testExitCode)" | Out-File -FilePath $reportFile -Append -Encoding utf8
  Write-Host "RESULT: FAIL (exit code $testExitCode)" -ForegroundColor Red
}
"Completed at $(Get-Date)" | Out-File -FilePath $reportFile -Append -Encoding utf8

exit $testExitCode