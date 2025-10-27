<?php
namespace App\Services;

class EmailService
{
    public static function send(string $to, string $subject, string $html): array
    {
        $dev = strtolower(getenv('EMAIL_DEV_MODE') ?: '') === 'true';
        if ($dev) {
            error_log("[email:dev] To={$to} Subject={$subject}\n{$html}");
            return ['ok' => true, 'dev' => true];
        }

        // SMTP via PHPMailer if configured (prefer SecureConfig like Node)
        $host = \App\Services\SecureConfig::getSecret('smtp_host') ?? '';
        $user = \App\Services\SecureConfig::getSecret('smtp_user') ?? '';
        $pass = \App\Services\SecureConfig::getSecret('smtp_pass') ?? '';
        $port = (int) (\App\Services\SecureConfig::getSecret('smtp_port') ?? (getenv('SMTP_PORT') ?: 587));
        $secure = strtolower((\App\Services\SecureConfig::getSecret('smtp_secure') ?? (getenv('SMTP_SECURE') ?: ''))) === 'true';
        $from = \App\Services\SecureConfig::getSecret('smtp_from') ?? (getenv('SMTP_FROM') ?: 'no-reply@example.com');

        if ($host && $user && $pass) {
            try {
                // Only attempt PHPMailer if the class is available via Composer autoload
                if (class_exists(\PHPMailer\PHPMailer\PHPMailer::class)) {
                    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
                    $mail->isSMTP();
                    $mail->Host = $host;
                    $mail->SMTPAuth = true;
                    $mail->Username = $user;
                    $mail->Password = $pass;
                    $mail->SMTPSecure = $secure ? \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS : false;
                    $mail->Port = $port;
                    $mail->setFrom($from, 'Ganudenu');
                    $mail->addAddress($to);
                    $mail->isHTML(true);
                    $mail->Subject = $subject;
                    $mail->Body = $html;
                    $mail->send();
                    return ['ok' => true];
                } else {
                    throw new \Error('PHPMailer not available');
                }
            } catch (\Throwable $e) {
                // Try native mail() as a lightweight fallback before Brevo
                error_log('[email] SMTP failed: ' . $e->getMessage());
            }
        }

        // Native mail() fallback if available and configured
        if (function_exists('mail')) {
            $headers = [];
            $headers[] = 'MIME-Version: 1.0';
            $headers[] = 'Content-type: text/html; charset=UTF-8';
            $headers[] = 'From: ' . sprintf('Ganudenu <%s>', $from);
            $sent = @mail($to, $subject, $html, implode("\r\n", $headers));
            if ($sent) {
                return ['ok' => true, 'fallback' => 'mail'];
            }
        }

        // Brevo HTTP fallback (prefer SecureConfig like Node)
        $apiKey = \App\Services\SecureConfig::getSecret('brevo_api_key') ?? (getenv('BREVO_API_KEY') ?: '');
        $login = \App\Services\SecureConfig::getSecret('brevo_login') ?? (getenv('BREVO_LOGIN') ?: '');
        if (!$apiKey || !$login) {
            $err = 'Email provider not configured';
            if (self::shouldSimulateOnFailure()) {
                error_log('[email:simulate] ' . $err . ' — simulating send OK in non-production/dev.');
                return ['ok' => true, 'simulated' => true];
            }
            return ['ok' => false, 'error' => $err];
        }
        try {
            $payload = [
                'sender' => ['name' => 'Ganudenu', 'email' => $login],
                'to' => [['email' => $to]],
                'subject' => $subject,
                'htmlContent' => $html
            ];
            $url = 'https://api.brevo.com/v3/smtp/email';
            $body = json_encode($payload);

            if (function_exists('curl_init')) {
                $ch = curl_init($url);
                $headers = ['Content-Type: application/json', 'api-key: ' . $apiKey];
                $opts = [
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_POST => true,
                    CURLOPT_HTTPHEADER => $headers,
                    CURLOPT_POSTFIELDS => $body,
                    CURLOPT_USERAGENT => 'ganudenu-php-backend'
                ];
                // Dev convenience: relax SSL in non-production if no CA bundle configured
                $env = strtolower(getenv('APP_ENV') ?: 'development');
                $hasCABundle = (string)(getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: (ini_get('openssl.cafile') ?: ''))) !== '';
                $forceInsecure = strtolower(getenv('OAUTH_INSECURE_SSL') ?: '') === 'true';
                $insecure = ($env !== 'production' && !$hasCABundle) || $forceInsecure;
                if ($insecure) {
                    $opts[CURLOPT_SSL_VERIFYPEER] = false;
                    $opts[CURLOPT_SSL_VERIFYHOST] = 0;
                }
                curl_setopt_array($ch, $opts);
                $resp = curl_exec($ch);
                $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
                curl_close($ch);
                if ($code >= 200 && $code < 300) {
                    return ['ok' => true];
                }
                $err = 'Brevo HTTP ' . $code;
                if (self::shouldSimulateOnFailure()) {
                    error_log('[email:simulate] ' . $err . ' — simulating send OK in non-production/dev.');
                    return ['ok' => true, 'simulated' => true, 'provider' => 'brevo'];
                }
                return ['ok' => false, 'error' => $err, 'provider' => 'brevo'];
            } else {
                // Try system curl binary first (works even if PHP cURL/openssl extensions are missing)
                $curlBin = null;
                $isWindows = stripos(PHP_OS, 'WIN') === 0;
                $candidates = $isWindows
                    ? ['C:\\Windows\\System32\\curl.exe']
                    : ['curl', '/usr/bin/curl', '/usr/local/bin/curl'];
                foreach ($candidates as $candidate) {
                    if ($candidate === 'curl' && !$isWindows) {
                        $w = trim((string)@shell_exec('command -v curl'));
                        if ($w) { $curlBin = $w; break; }
                    } else {
                        if (is_file($candidate)) { $curlBin = $candidate; break; }
                    }
                }
                if ($curlBin) {
                    $cmd = escapeshellcmd($curlBin);
                    $args = [];
                    $args[] = '-sS';
                    $args[] = '--max-time 15';
                    $args[] = '-L';
                    $args[] = '-i'; // include response headers
                    $args[] = '-A ' . escapeshellarg('ganudenu-php-backend');
                    // In dev, allow insecure if needed
                    $env = strtolower(getenv('APP_ENV') ?: 'development');
                    $forceInsecure = strtolower(getenv('OAUTH_INSECURE_SSL') ?: '') === 'true';
                    if ($env !== 'production' || $forceInsecure) $args[] = '-k';
                    $args[] = '-H ' . escapeshellarg('Content-Type: application/json');
                    $args[] = '-H ' . escapeshellarg('api-key: ' . $apiKey);
                    $args[] = '--data ' . escapeshellarg($body);
                    $args[] = escapeshellarg($url);

                    $full = $cmd . ' ' . implode(' ', $args);
                    $out = @shell_exec($full);
                    $status = 0;
                    if (is_string($out) && $out !== '') {
                        // Parse last header block for status
                        $posCRLF = strrpos($out, "\r\n\r\n");
                        $posLF = strrpos($out, "\n\n");
                        $sepPos = max($posCRLF !== false ? $posCRLF : -1, $posLF !== false ? $posLF : -1);
                        $rawHdrs = $sepPos !== -1 ? substr($out, 0, $sepPos) : '';
                        if ($rawHdrs !== '') {
                            if (preg_match_all('#^HTTP/\d(?:\.\d)?\s+(\d{3})#m', $rawHdrs, $mm) && !empty($mm[1])) {
                                $status = (int) end($mm[1]);
                            }
                        } else {
                            if (preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#m', $out, $m1)) {
                                $status = (int)$m1[1];
                            }
                        }
                    }
                    if ($status >= 200 && $status < 300) {
                        return ['ok' => true];
                    }
                    $err = 'Brevo HTTP ' . $status;
                    if (self::shouldSimulateOnFailure()) {
                        error_log('[email:simulate] ' . $err . ' — simulating send OK in non-production/dev.');
                        return ['ok' => true, 'simulated' => true, 'provider' => 'brevo'];
                    }
                    return ['ok' => false, 'error' => $err, 'provider' => 'brevo'];
                }

                // Fallback using stream context (works without cURL extension, may require openssl for HTTPS)
                $headers = [
                    'Content-Type: application/json',
                    'api-key: ' . $apiKey,
                    'User-Agent: ganudenu-php-backend',
                    'Connection: close'
                ];
                $env = strtolower(getenv('APP_ENV') ?: 'development');
                $hasCABundle = (string)(getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: (ini_get('openssl.cafile') ?: ''))) !== '';
                $forceInsecure = strtolower(getenv('OAUTH_INSECURE_SSL') ?: '') === 'true';
                $insecure = ($env !== 'production' && !$hasCABundle) || $forceInsecure;

                $sslCtx = [
                    'verify_peer' => !$insecure,
                    'verify_peer_name' => !$insecure,
                    'allow_self_signed' => $insecure,
                ];
                $cafile = getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: '');
                if ($cafile) {
                    $sslCtx['cafile'] = $cafile;
                }

                $ctxArr = [
                    'http' => [
                        'method' => 'POST',
                        'header' => implode("\r\n", $headers),
                        'content' => $body,
                        'timeout' => 15,
                        'ignore_errors' => true,
                        'protocol_version' => 1.1
                    ],
                    'ssl' => $sslCtx
                ];
                $ctx = stream_context_create($ctxArr);
                $resp = @file_get_contents($url, false, $ctx);
                $status = 0;
                if (isset($http_response_header) && is_array($http_response_header)) {
                    foreach ($http_response_header as $h) {
                        if (preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#', $h, $m)) {
                            $status = (int)$m[1];
                            break;
                        }
                    }
                }
                if ($status >= 200 && $status < 300) {
                    return ['ok' => true];
                }
                $err = 'Brevo HTTP ' . $status;
                if (self::shouldSimulateOnFailure()) {
                    error_log('[email:simulate] ' . $err . ' — simulating send OK in non-production/dev.');
                    return ['ok' => true, 'simulated' => true, 'provider' => 'brevo'];
                }
                return ['ok' => false, 'error' => $err, 'provider' => 'brevo'];
            }
        } catch (\Throwable $e) {
            $err = $e->getMessage();
            if (self::shouldSimulateOnFailure()) {
                error_log('[email:simulate] ' . $err . ' — simulating send OK in non-production/dev.');
                return ['ok' => true, 'simulated' => true, 'provider' => 'brevo'];
            }
            return ['ok' => false, 'error' => $err, 'provider' => 'brevo'];
        }
    }

    // Final non-production fallback: do not block flows during local/dev
    private static function shouldSimulateOnFailure(): bool
    {
        // Only simulate when explicitly enabled via EMAIL_DEV_MODE=true.
        // This allows real sends in development environments when desired.
        $devMode = strtolower(getenv('EMAIL_DEV_MODE') ?: '') === 'true';
        return $devMode;
    }

    public static function generateOtp(): string
    {
        return (string) random_int(1000, 9999);
    }
 
    // Parity with Node: GN-<base36 timestamp>-<base36 random> (3 chars), uppercase
    public static function generateUserUID(): string
    {
        $ts = strtoupper(base_convert((string)time(), 10, 36));
        $rand = random_int(0, 36*36*36 - 1);
        $rnd = strtoupper(str_pad(base_convert((string)$rand, 10, 36), 3, '0', STR_PAD_LEFT));
        return 'GN-' . $ts . '-' . $rnd;
    }
}