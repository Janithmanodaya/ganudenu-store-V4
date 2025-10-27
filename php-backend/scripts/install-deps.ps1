# Install PHP backend dependencies and verify PHPMailer availability.
# - Ensures PHP is present
# - Ensures Composer is available (installs local composer.phar if missing)
# - Runs composer install in php-backend
# - Verifies PHPMailer class; if missing, runs composer require phpmailer/phpmailer
# - Prints summary diagnostics (PHP modules, vendor/autoload.php presence)

param(
    [switch]$VerboseOutput
)

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# Our scripts are under php-backend/scripts; the PHP backend root is the parent of this script directory.
$phpBackend = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repoRoot = $phpBackend
$vendorAutoload = Join-Path $phpBackend "vendor\autoload.php"
$localComposerPhar = Join-Path $phpBackend "composer.phar"

Write-Info "Repository root: $repoRoot"
Write-Info "PHP backend dir: $phpBackend"

# 1) Ensure PHP
$phpCmd = Get-Command php -ErrorAction SilentlyContinue
if (-not $phpCmd) {
    Write-Err "PHP executable not found in PATH. Install PHP 8.x and ensure 'php' is available."
    exit 1
}
Write-Info "PHP found: $($phpCmd.Source)"

# 2) Check required PHP extensions (openssl for HTTPS, curl optional)
try {
    $opensslStatus = & $phpCmd.Source -r "echo extension_loaded('openssl') ? 'on' : 'off';"
} catch { $opensslStatus = "off" }
try {
    $curlStatus = & $phpCmd.Source -r "echo extension_loaded('curl') ? 'on' : 'off';"
} catch { $curlStatus = "off" }

Write-Info "PHP modules: openssl=$opensslStatus, curl=$curlStatus"
if ($opensslStatus -ne "on") {
    Write-Err "The PHP 'openssl' extension is OFF. Composer and secure HTTPS transfers require it. Enable openssl in php.ini (extension=openssl) and re-run."
    Write-Err "Hint: Ensure php_openssl.dll exists in your PHP ext directory and extension_dir points to it."
    exit 1
}

# 3) Ensure Composer
$composerCmd = Get-Command composer -ErrorAction SilentlyContinue
$composerAvailable = $null -ne $composerCmd
if ($composerAvailable) {
    Write-Info "Composer found: $($composerCmd.Source)"
} else {
    Write-Warn "Composer CLI not found. Will install a local composer.phar in php-backend."
    Push-Location $phpBackend
    try {
        Write-Info "Downloading Composer installer (PowerShell)..."
        $installerPath = Join-Path $phpBackend "composer-setup.php"
        $sigUrl = "https://composer.github.io/installer.sig"
        $installerUrl = "https://getcomposer.org/installer"
        Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath

        Write-Info "Verifying installer signature (PowerShell)..."
        $expectedSig = (Invoke-RestMethod -UseBasicParsing $sigUrl).Trim()
        $actualSha384 = (Get-FileHash -Algorithm SHA384 $installerPath).Hash.ToLower()
        if ($actualSha384 -ne $expectedSig.ToLower()) {
            Write-Err "Composer installer signature mismatch. Expected: $expectedSig, Actual: $actualSha384"
            Remove-Item $installerPath -ErrorAction SilentlyContinue
            throw "Composer installer verification failed."
        } else {
            Write-Info "Installer verified."
        }

        Write-Info "Running Composer installer..."
        php $installerPath --install-dir . --filename composer.phar | Out-Host
        Remove-Item $installerPath -ErrorAction SilentlyContinue
        if (Test-Path $localComposerPhar) {
            Write-Info "Local composer.phar installed: $localComposerPhar"
            $composerAvailable = $true
        } else {
            Write-Err "Failed to install composer.phar."
        }
    } catch {
        Write-Err "Composer installer failed: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# 4) Run composer install
Push-Location $phpBackend
try {
    if ($composerAvailable -and $composerCmd) {
        Write-Info "Running: composer install (in $phpBackend)"
        composer install
    } elseif (Test-Path $localComposerPhar) {
        Write-Info "Running: php composer.phar install (in $phpBackend)"
        php ".\composer.phar" install
    } else {
        Write-Err "Composer is not available. Aborting."
        exit 1
    }
} catch {
    Write-Err "composer install failed: $($_.Exception.Message)"
} finally {
    Pop-Location
}

# 5) Verify vendor/autoload.php
if (Test-Path $vendorAutoload) {
    Write-Info "vendor/autoload.php exists."
} else {
    Write-Err "vendor/autoload.php not found after install. Check composer output."
}

# 6) Verify PHPMailer class; if missing, require explicitly
$phpTestCmd = @"
require '$vendorAutoload';
echo class_exists('PHPMailer\\PHPMailer\\PHPMailer') ? 'OK' : 'MISSING';
"@
$existsOut = & $phpCmd.Source -r $phpTestCmd
Write-Info "PHPMailer class_exists: $existsOut"
if ($existsOut -ne "OK") {
    Write-Warn "PHPMailer class missing. Attempting to install phpmailer/phpmailer..."
    Push-Location $phpBackend
    try {
        if ($composerAvailable -and $composerCmd) {
            composer require phpmailer/phpmailer:^6.8
        } elseif (Test-Path $localComposerPhar) {
            php ".\composer.phar" require phpmailer/phpmailer:^6.8
        } else {
            Write-Err "Composer not available for 'require phpmailer/phpmailer'."
        }
    } catch {
        Write-Err "composer require phpmailer/phpmailer failed: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
    # Re-check
    $existsOut = & $phpCmd.Source -r $phpTestCmd
    Write-Info "PHPMailer class_exists (after require): $existsOut"
}

# 7) Print basic PHP module diagnostics useful for email/HTTP operations
Write-Info "PHP modules snapshot (openssl, curl):"
try {
    $modsCmd = @"
echo (extension_loaded('openssl') ? 'openssl:on' : 'openssl:off') . PHP_EOL . (extension_loaded('curl') ? 'curl:on' : 'curl:off');
"@
    $mods = & $phpCmd.Source -r $modsCmd
    Write-Host $mods
} catch {
    Write-Warn "Failed to get PHP modules: $($_.Exception.Message)"
}

Write-Info "Done.", "extension=openssl")
            $updated = $true
        } elseif ($iniContent -notmatch '(?im)^\s*extension\s*=\s*openssl') {
            $iniContent += "`r`nextension=openssl`r`n"
            $updated = $true
        }

        if ($updated) {
            Copy-Item $iniPath "$iniPath.bak" -Force
            Set-Content -Path $iniPath -Value $iniContent -Encoding UTF8
            Write-Info "Updated php.ini to enable openssl and set extension_dir. Backup saved to $iniPath.bak"
        }

        # Verify again
        $status2 = & $phpCmd.Source -r "echo extension_loaded('openssl') ? 'on' : 'off';"
        if ($status2 -eq "on") {
            Write-Info "PHP openssl extension is now enabled."
            return $true
        } else {
            Write-Err "Failed to enable openssl via php.ini. Please enable it manually (extension_dir and extension=openssl) and re-run."
            return $false
        }
    } catch {
        Write-Err "Error updating php.ini: $($_.Exception.Message)"
        return $false
    }
}

$opensslOk = Ensure-PhpOpenSsl
if (-not $opensslOk) {
    Write-Err "Cannot proceed without PHP openssl extension. Aborting."
    exit 1
}

# 2) Ensure Composer
$composerCmd = Get-Command composer -ErrorAction SilentlyContinue
$composerAvailable = $null -ne $composerCmd
if ($composerAvailable) {
    Write-Info "Composer found: $($composerCmd.Source)"
} else {
    Write-Warn "Composer CLI not found. Will install a local composer.phar in php-backend."
    Push-Location $phpBackend
    try {
        Write-Info "Downloading Composer installer (PowerShell)..."
        $installerPath = Join-Path $phpBackend "composer-setup.php"
        $sigUrl = "https://composer.github.io/installer.sig"
        $installerUrl = "https://getcomposer.org/installer"
        Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath

        Write-Info "Verifying installer signature (PowerShell)..."
        $expectedSig = (Invoke-RestMethod -UseBasicParsing $sigUrl).Trim()
        $actualSha384 = (Get-FileHash -Algorithm SHA384 $installerPath).Hash.ToLower()
        if ($actualSha384 -ne $expectedSig.ToLower()) {
            Write-Err "Composer installer signature mismatch. Expected: $expectedSig, Actual: $actualSha384"
            Remove-Item $installerPath -ErrorAction SilentlyContinue
            throw "Composer installer verification failed."
        } else {
            Write-Info "Installer verified."
        }

        Write-Info "Running Composer installer..."
        php $installerPath --install-dir . --filename composer.phar | Out-Host
        Remove-Item $installerPath -ErrorAction SilentlyContinue
        if (Test-Path $localComposerPhar) {
            Write-Info "Local composer.phar installed: $localComposerPhar"
            $composerAvailable = $true
        } else {
            Write-Err "Failed to install composer.phar."
        }
    } catch {
        Write-Err "Composer installer failed: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
}

# 3) Run composer install
Push-Location $phpBackend
try {
    if ($composerAvailable -and $composerCmd) {
        Write-Info "Running: composer install (in $phpBackend)"
        composer install
    } elseif (Test-Path $localComposerPhar) {
        Write-Info "Running: php composer.phar install (in $phpBackend)"
        php ".\composer.phar" install
    } else {
        Write-Err "Composer is not available. Aborting."
        exit 1
    }
} catch {
    Write-Err "composer install failed: $($_.Exception.Message)"
} finally {
    Pop-Location
}

# 4) Verify vendor/autoload.php
if (Test-Path $vendorAutoload) {
    Write-Info "vendor/autoload.php exists."
} else {
    Write-Err "vendor/autoload.php not found after install. Check composer output."
}

# 5) Verify PHPMailer class; if missing, require explicitly
$phpTestCmd = "require '$vendorAutoload'; echo class_exists('PHPMailer\PHPMailer\PHPMailer') ? 'OK' : 'MISSING';"
$existsOut = & $phpCmd.Source -r $phpTestCmd
Write-Info "PHPMailer class_exists: $existsOut"
if ($existsOut -ne "OK") {
    Write-Warn "PHPMailer class missing. Attempting to install phpmailer/phpmailer..."
    Push-Location $phpBackend
    try {
        if ($composerAvailable -and $composerCmd) {
            composer require phpmailer/phpmailer:^6.8
        } elseif (Test-Path $localComposerPhar) {
            php ".\composer.phar" require phpmailer/phpmailer:^6.8
        } else {
            Write-Err "Composer not available for 'require phpmailer/phpmailer'."
        }
    } catch {
        Write-Err "composer require phpmailer/phpmailer failed: $($_.Exception.Message)"
    } finally {
        Pop-Location
    }
    # Re-check
    $existsOut = & $phpCmd.Source -r $phpTestCmd
    Write-Info "PHPMailer class_exists (after require): $existsOut"
}

# 6) Print basic PHP module diagnostics useful for email/HTTP operations
Write-Info "PHP modules snapshot (openssl, curl):"
try {
    $mods = & $phpCmd.Source -r "echo (extension_loaded('openssl') ? 'openssl:on' : 'openssl:off') . PHP_EOL . (extension_loaded('curl') ? 'curl:on' : 'curl:off');"
    Write-Host $mods
} catch {
    Write-Warn "Failed to get PHP modules: $($_.Exception.Message)"
}

Write-Info "Done."