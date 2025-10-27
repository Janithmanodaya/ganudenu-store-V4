# Clean installer: install Composer, dependencies, and verify PHPMailer.
# This script avoids complex edits and assumes PHP openssl is enabled.

param(
    [switch]$VerboseOutput
)

function Write-Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# Determine backend root (this script lives in php-backend/scripts)
$phpBackend = (Resolve-Path (Split-Path -Parent $PSScriptRoot)).Path
$vendorAutoload = Join-Path $phpBackend "vendor\autoload.php"
$localComposerPhar = Join-Path $phpBackend "composer.phar"

Write-Info ("PHP backend dir: {0}" -f $phpBackend)

# 1) Ensure PHP available
$phpCmd = Get-Command php -ErrorAction SilentlyContinue
if (-not $phpCmd) {
    Write-Err "PHP executable not found in PATH. Install PHP 8.x and ensure 'php' is available."
    exit 1
}
Write-Info ("PHP found: {0}" -f $phpCmd.Source)

# 2) Check required PHP extensions (openssl for HTTPS, curl optional)
try { $opensslStatus = & $phpCmd.Source -r "echo extension_loaded('openssl') ? 'on' : 'off';" } catch { $opensslStatus = "off" }
try { $curlStatus    = & $phpCmd.Source -r "echo extension_loaded('curl') ? 'on' : 'off';" } catch { $curlStatus = "off" }

Write-Info ("PHP modules: openssl={0}, curl={1}" -f $opensslStatus, $curlStatus)
if ($opensslStatus -ne "on") {
    Write-Err "The PHP 'openssl' extension is OFF. Composer and secure HTTPS transfers require it."
    Write-Err "Enable openssl in php.ini (extension=openssl) and ensure php_openssl.dll is present in your PHP ext directory."
    exit 1
}

# 3) Ensure Composer
$composerCmd = Get-Command composer -ErrorAction SilentlyContinue
$composerAvailable = $null -ne $composerCmd
if ($composerAvailable) {
    Write-Info ("Composer found: {0}" -f $composerCmd.Source)
} else {
    Write-Warn "Composer CLI not found. Installing local composer.phar in php-backend..."
    Push-Location $phpBackend
    try {
        $installerPath = Join-Path $phpBackend "composer-setup.php"
        $sigUrl = "https://composer.github.io/installer.sig"
        $installerUrl = "https://getcomposer.org/installer"

        Write-Info "Downloading Composer installer..."
        Invoke-WebRequest -UseBasicParsing -Uri $installerUrl -OutFile $installerPath

        Write-Info "Verifying installer signature..."
        $expectedSig = (Invoke-RestMethod -UseBasicParsing $sigUrl).Trim().ToLower()
        $actualSha384 = (Get-FileHash -Algorithm SHA384 $installerPath).Hash.ToLower()
        if ($actualSha384 -ne $expectedSig) {
            Write-Err ("Composer installer signature mismatch. Expected={0} Actual={1}" -f $expectedSig, $actualSha384)
            Remove-Item $installerPath -ErrorAction SilentlyContinue
            throw "Composer installer verification failed."
        }

        Write-Info "Running Composer installer..."
        php $installerPath --install-dir . --filename composer.phar | Out-Host
        Remove-Item $installerPath -ErrorAction SilentlyContinue

        if (Test-Path $localComposerPhar) {
            Write-Info ("Local composer.phar installed: {0}" -f $localComposerPhar)
            $composerAvailable = $true
        } else {
            Write-Err "Failed to install composer.phar."
        }
    } catch {
        Write-Err ("Composer installer failed: {0}" -f $_.Exception.Message)
    } finally {
        Pop-Location
    }
}

# 4) Run composer install
Push-Location $phpBackend
$installOk = $false
try {
    if ($composerAvailable -and $composerCmd) {
        Write-Info "Running: composer install"
        composer install
        $installOk = $true
    } elseif (Test-Path $localComposerPhar) {
        Write-Info "Running: php composer.phar install"
        php ".\composer.phar" install
        $installOk = $true
    } else {
        Write-Err "Composer is not available. Aborting."
        exit 1
    }
} catch {
    Write-Warn ("composer install failed: {0}" -f $_.Exception.Message)
} finally {
    Pop-Location
}

# 5) Verify vendor/autoload.php (and try a targeted fallback if ext-fileinfo blocks install)
if (Test-Path $vendorAutoload) {
    Write-Info "vendor/autoload.php exists."
} else {
    # Check for missing fileinfo extension and try ignoring platform req temporarily
    try {
        $fileinfoStatus = & $phpCmd.Source -r "echo extension_loaded('fileinfo') ? 'on' : 'off';"
    } catch { $fileinfoStatus = "off" }
    if ($fileinfoStatus -ne "on") {
        Write-Warn "PHP 'fileinfo' extension is OFF. intervention/image requires ext-fileinfo."
        Write-Warn "Temporary fallback: running composer install --ignore-platform-req=ext-fileinfo"
        Push-Location $phpBackend
        try {
            if ($composerAvailable -and $composerCmd) {
                composer install --ignore-platform-req=ext-fileinfo
            } elseif (Test-Path $localComposerPhar) {
                php ".\composer.phar" install --ignore-platform-req=ext-fileinfo
            }
        } catch {
            Write-Err ("composer install (ignore fileinfo) failed: {0}" -f $_.Exception.Message)
        } finally {
            Pop-Location
        }
        if (Test-Path $vendorAutoload) {
            Write-Info "vendor/autoload.php exists (after ignore fileinfo)."
        } else {
            Write-Err "vendor/autoload.php still missing. Enable PHP fileinfo extension in php.ini and re-run."
        }
    } else {
        Write-Err "vendor/autoload.php not found after install. Check composer output."
    }
}

# 6) Verify PHPMailer class; if missing, require explicitly
if (Test-Path $vendorAutoload) {
    $phpTestCmd = @"
require '$vendorAutoload';
echo class_exists('PHPMailer\\PHPMailer\\PHPMailer') ? 'OK' : 'MISSING';
"@
    $existsOut = & $phpCmd.Source -r $phpTestCmd
    Write-Info ("PHPMailer class_exists: {0}" -f $existsOut)
    if ($existsOut -ne "OK") {
        Write-Warn "PHPMailer class missing. Attempting to install phpmailer/phpmailer..."
        Push-Location $phpBackend
        try {
            if ($composerAvailable -and $composerCmd) {
                composer require phpmailer/phpmailer:^6.8 --ignore-platform-req=ext-fileinfo
            } elseif (Test-Path $localComposerPhar) {
                php ".\composer.phar" require phpmailer/phpmailer:^6.8 --ignore-platform-req=ext-fileinfo
            } else {
                Write-Err "Composer not available for 'require phpmailer/phpmailer'."
            }
        } catch {
            Write-Err ("composer require phpmailer/phpmailer failed: {0}" -f $_.Exception.Message)
        } finally {
            Pop-Location
        }
        # Re-check
        $existsOut = & $phpCmd.Source -r $phpTestCmd
        Write-Info ("PHPMailer class_exists (after require): {0}" -f $existsOut)
    }
} else {
    Write-Warn "Skipping PHPMailer class check because vendor/autoload.php is missing."
}

# 7) Print basic PHP module diagnostics useful for email/HTTP operations
Write-Info "PHP modules snapshot (openssl, curl):"
$modsCmd = @"
echo (extension_loaded('openssl') ? 'openssl:on' : 'openssl:off') . PHP_EOL . (extension_loaded('curl') ? 'curl:on' : 'curl:off');
"@
try {
    $mods = & $phpCmd.Source -r $modsCmd
    Write-Host $mods
} catch {
    Write-Warn ("Failed to get PHP modules: {0}" -f $_.Exception.Message)
}

Write-Info "Done."