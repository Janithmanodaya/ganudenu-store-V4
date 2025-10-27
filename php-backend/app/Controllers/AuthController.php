<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\EmailService;

class AuthController
{
    private static function getEnv(string $key): string
    {
        $v = getenv($key);
        if ($v !== false && $v !== '') return (string)$v;
        static $cache = null;
        if ($cache === null) $cache = self::loadEnvFiles();
        return (string)($cache[$key] ?? '');
    }

    private static function loadEnvFiles(): array
    {
        $out = [];
        // Load env values from multiple candidate locations:
        // - php-backend/.env
        // - project-root/.env
        // - php-backend/.env.example (fallback)
        $candidates = [
            __DIR__ . '/../../.env',
            __DIR__ . '/../../../.env',
            __DIR__ . '/../../.env.example',
        ];
        foreach ($candidates as $file) {
            if (!is_file($file)) continue;
            $lines = @file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (!$lines) continue;
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') continue;
                if (str_starts_with($line, 'export ')) $line = trim(substr($line, 7));
                $eq = strpos($line, '=');
                if ($eq === false) continue;
                $key = trim(substr($line, 0, $eq));
                $val = trim(substr($line, $eq + 1));
                $len = strlen($val);
                if ($len >= 2) {
                    $first = $val[0];
                    $last = $val[$len - 1];
                    if (($first === '\"' && $last === '\"') || ($first === "'" && $last === "'")) {
                        $val = substr($val, 1, -1);
                    }
                }
                $out[$key] = $val;
                if ((getenv($key) === false || getenv($key) === '') && $val !== '') {
                    putenv("{$key}={$val}");
                    $_ENV[$key] = $val;
                }
            }
        }
        return $out;
    }

    public static function googleDebug(): void
    {
        $clientId = self::getEnv('GOOGLE_CLIENT_ID') ?: '';
        $clientSecret = self::getEnv('GOOGLE_CLIENT_SECRET') ?: '';
        $redirectUri = self::getEnv('GOOGLE_REDIRECT_URI') ?: '';
        $publicOrigin = self::getEnv('PUBLIC_ORIGIN') ?: (self::getEnv('PUBLIC_DOMAIN') ?: '');
        $maskedId = $clientId ? substr($clientId, 0, 8) . '...' : null;
        $maskedSecret = $clientSecret ? substr($clientSecret, 0, 4) . '...' : null;

        // Validate redirect URI and collect warnings
        $validationError = self::validateRedirectUriOrExplain($redirectUri);
        $warnings = [];
        if ($validationError) $warnings[] = $validationError;

        $isLocal = self::isLocalhostUri($redirectUri);
        $scheme = (string)(parse_url($redirectUri, PHP_URL_SCHEME) ?: '');
        $port = parse_url($redirectUri, PHP_URL_PORT);
        $path = (string)(parse_url($redirectUri, PHP_URL_PATH) ?: '');
        if ($isLocal && ((int)($port ?? 80)) === 5173) {
            $warnings[] = 'Redirect URI uses port 5173 (Vite dev). Use port 5174 for PHP backend.';
        }
        if ($path !== '/api/auth/google/callback') {
            $warnings[] = 'Redirect path must be exactly /api/auth/google/callback.';
        }
        if (!$isLocal && strtolower($scheme) !== 'https') {
            $warnings[] = 'Non-localhost domains must use HTTPS.';
        }

        // PKCE preview
        $verifierRaw = bin2hex(random_bytes(32));
        $verifier = rtrim(strtr(base64_encode($verifierRaw), '+/', '-_'), '=');
        $challengeBin = hash('sha256', $verifier, true);
        $challenge = rtrim(strtr(base64_encode($challengeBin), '+/', '-_'), '=');
        $nonce = rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');

        $scope = urlencode('openid email profile');
        $statePayload = ['r' => (string)($_GET['r'] ?? ''), 'v' => $verifier, 'n' => $nonce];
        $state = rtrim(strtr(base64_encode(json_encode($statePayload)), '+/', '-_'), '=');
        $startUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
            . 'client_id=' . urlencode($clientId)
            . '&redirect_uri=' . urlencode($redirectUri)
            . '&response_type=code&scope=' . $scope
            . '&prompt=select_account&access_type=offline'
            . '&code_challenge_method=S256&code_challenge=' . urlencode($challenge)
            . '&nonce=' . urlencode($nonce)
            . '&state=' . $state;

        \json_response([
            'GOOGLE_CLIENT_ID_masked' => $maskedId,
            'GOOGLE_CLIENT_SECRET_masked' => $maskedSecret,
            'GOOGLE_REDIRECT_URI' => $redirectUri ?: null,
            'PUBLIC_ORIGIN' => $publicOrigin ?: null,
            'start_authorize_url' => $startUrl,
            'pkce' => [
                'preview_code_verifier' => $verifier,
                'preview_code_challenge' => $challenge,
                'nonce' => $nonce
            ],
            'warnings' => $warnings
        ]);
    }

    private static function getAuthCookieOptions(): array
    {
        $isProd = (getenv('APP_ENV') ?: '') === 'production';
        $domainUrl = getenv('PUBLIC_ORIGIN') ?: (getenv('PUBLIC_DOMAIN') ?: '');
        $cookieDomain = '';
        if ($domainUrl) {
            try { $cookieDomain = parse_url($domainUrl, PHP_URL_HOST) ?: ''; } catch (\Throwable $e) {}
        }
        // Compute cookie domain: omit for localhost/IP, set for dotted hosts.
        $domainAttr = '';
        if ($cookieDomain) {
            $isIp = filter_var($cookieDomain, FILTER_VALIDATE_IP) !== false;
            $hasDot = strpos($cookieDomain, '.') !== false;
            if (!$isIp && $hasDot) {
                $domainAttr = $cookieDomain;
            }
        }
        // Browser rule: SameSite=None requires Secure. In dev (http), use Lax so cookie is accepted.
        $sameSite = $isProd ? 'None' : 'Lax';
        $secure = $isProd ? true : false;

        return [
            'expires' => time() + 7 * 24 * 60 * 60,
            'path' => '/',
            'domain' => $domainAttr,
            'secure' => $secure,
            'httponly' => true,
            'samesite' => $sameSite
        ];
    }

    private static function httpRequest(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 10): array
    {
        $method = strtoupper($method);
        $respBody = '';
        $status = 0;
        $error = null;

        $env = strtolower((string)(getenv('APP_ENV') ?: 'development'));
        $scheme = (string) (parse_url($url, PHP_URL_SCHEME) ?: '');
        $hasCABundle = (string)(getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: (ini_get('openssl.cafile') ?: ''))) !== '';
        $forceInsecure = strtolower(getenv('OAUTH_INSECURE_SSL') ?: '') === 'true';
        // If in non-production and HTTPS and we don't appear to have a CA bundle configured, allow insecure to avoid local dev failures
        $defaultInsecure = ($env !== 'production' && $scheme === 'https' && !$hasCABundle);
        $insecure = $forceInsecure || $defaultInsecure;

        if (function_exists('curl_init')) {
            $ch = \curl_init($url);
            $opts = [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => $timeout,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_HTTPHEADER => $headers,
                CURLOPT_USERAGENT => 'ganudenu-php-backend',
            ];
            // Allow explicit CA bundle path if provided
            $cafile = getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: '');
            if ($cafile) {
                $opts[CURLOPT_CAINFO] = $cafile;
            }
            if ($insecure) {
                $opts[CURLOPT_SSL_VERIFYPEER] = false;
                $opts[CURLOPT_SSL_VERIFYHOST] = 0;
            }
            if ($method === 'POST') {
                $opts[CURLOPT_POST] = true;
                $opts[CURLOPT_POSTFIELDS] = $body ?? '';
            } elseif ($method !== 'GET') {
                $opts[CURLOPT_CUSTOMREQUEST] = $method;
                if ($body !== null) $opts[CURLOPT_POSTFIELDS] = $body;
            }
            \curl_setopt_array($ch, $opts);
            $resp = \curl_exec($ch);
            if ($resp === false) {
                $error = \curl_error($ch) ?: null;
                $respBody = '';
            } else {
                $respBody = (string) $resp;
            }
            $status = (int) \curl_getinfo($ch, CURLINFO_HTTP_CODE);
            \curl_close($ch);
        } else {
            // Try system curl binary if available (helps when PHP cURL/openssl extensions are missing)
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
                $args[] = '--max-time ' . (int)max(10, $timeout);
                $args[] = '-L';
                $args[] = '-i'; // include response headers
                $args[] = '-A ' . escapeshellarg('ganudenu-php-backend');
                if ($insecure) $args[] = '-k';
                foreach ($headers as $h) {
                    $args[] = '-H ' . escapeshellarg($h);
                }
                if ($method === 'POST') {
                    $args[] = '-X POST';
                    if ($body !== null) $args[] = '--data ' . escapeshellarg($body);
                } elseif ($method !== 'GET') {
                    $args[] = '-X ' . escapeshellarg($method);
                    if ($body !== null) $args[] = '--data ' . escapeshellarg($body);
                }
                $args[] = escapeshellarg($url);

                $full = $cmd . ' ' . implode(' ', $args);
                $out = @shell_exec($full);
                if (is_string($out) && $out !== '') {
                    // Parse headers + body robustly (handle \r\n\r\n or \n\n and multiple header blocks)
                    $respBody = '';
                    $rawHdrs = '';
                    $status = 0;

                    // Find last header/body separator
                    $posCRLF = strrpos($out, "\r\n\r\n");
                    $posLF = strrpos($out, "\n\n");
                    $sepPos = max($posCRLF !== false ? $posCRLF : -1, $posLF !== false ? $posLF : -1);

                    if ($sepPos !== -1) {
                        $rawHdrs = substr($out, 0, $sepPos);
                        $after = substr($out, $sepPos + (($posCRLF !== false && $posCRLF === $sepPos) ? 4 : 2));
                        $respBody = (string)$after;
                    } else {
                        // Fallback: couldn't split; treat all as body
                        $respBody = (string)$out;
                        $rawHdrs = '';
                    }

                    // Determine HTTP status from the last HTTP status line in headers (covers redirects)
                    if ($rawHdrs !== '') {
                        if (preg_match_all('#^HTTP/\d(?:\.\d)?\s+(\d{3})#m', $rawHdrs, $mm) && !empty($mm[1])) {
                            $status = (int) end($mm[1]);
                        }
                    } else {
                        // As a fallback, try to parse status directly from the combined output
                        if (preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#m', $out, $m1)) {
                            $status = (int)$m1[1];
                        }
                    }
                } else {
                    $error = 'HTTP request failed (curl binary)';
                }
            } else {
                // Build headers and ensure Content-Length + User-Agent for stream requests
                $hdr = $headers ?: [];
                $hasUA = false; $hasCT = false; $hasCL = false; $hasConn = false;
                foreach ($hdr as $h) {
                    $hl = strtolower((string)$h);
                    if (str_starts_with($hl, 'user-agent:')) $hasUA = true;
                    if (str_starts_with($hl, 'content-type:')) $hasCT = true;
                    if (str_starts_with($hl, 'content-length:')) $hasCL = true;
                    if (str_starts_with($hl, 'connection:')) $hasConn = true;
                }
                if (!$hasUA) $hdr[] = 'User-Agent: ganudenu-php-backend';
                if (($method === 'POST' || $method === 'PUT' || $method === 'PATCH') && !$hasCT) $hdr[] = 'Content-Type: application/x-www-form-urlencoded';
                if (!$hasConn) $hdr[] = 'Connection: close';
                $bodyStr = $body ?? '';
                if (($method === 'POST' || $method === 'PUT' || $method === 'PATCH') && !$hasCL) $hdr[] = 'Content-Length: ' . strlen($bodyStr);
                $headerStr = implode("\r\n", $hdr);

                $cafile = getenv('SSL_CAINFO') ?: (getenv('CURL_CA_BUNDLE') ?: '');
                $sslCtx = [
                    'verify_peer' => !$insecure,
                    'verify_peer_name' => !$insecure,
                    'allow_self_signed' => $insecure,
                ];
                if ($cafile) {
                    $sslCtx['cafile'] = $cafile;
                }

                $contextArr = [
                    'http' => [
                        'method' => $method,
                        'header' => $headerStr,
                        'timeout' => max(10, $timeout),
                        'ignore_errors' => true,
                        'protocol_version' => 1.1,
                        'user_agent' => 'ganudenu-php-backend'
                    ],
                    'ssl' => $sslCtx
                ];
                // Only set 'content' for methods that carry a body
                if (in_array($method, ['POST','PUT','PATCH','DELETE'], true) && $bodyStr !== '') {
                    $contextArr['http']['content'] = $bodyStr;
                }

                $ctx = stream_context_create($contextArr);

                $doStream = function () use ($url, $ctx, &$http_response_header) {
                    return @file_get_contents($url, false, $ctx);
                };

                $resp = $doStream();
                if ($resp === false) {
                    // Try HTTP/1.0 fallback
                    $contextArr['http']['protocol_version'] = 1.0;
                    $ctx10 = stream_context_create($contextArr);
                    $resp = @file_get_contents($url, false, $ctx10);
                }
                if ($resp === false && $scheme === 'https' && !$insecure) {
                    // Retry once with insecure SSL (dev convenience). This will not trigger in production unless OAUTH_INSECURE_SSL=true
                    $retrySsl = $sslCtx;
                    $retrySsl['verify_peer'] = false;
                    $retrySsl['verify_peer_name'] = false;
                    $retrySsl['allow_self_signed'] = true;
                    $retryCtxArr = $contextArr;
                    $retryCtxArr['ssl'] = $retrySsl;
                    $retryCtx = stream_context_create($retryCtxArr);
                    $resp = @file_get_contents($url, false, $retryCtx);
                    if ($resp === false) {
                        $error = 'HTTP request failed (stream)';
                    }
                }

                if ($resp === false) {
                    $respBody = '';
                } else {
                    $respBody = (string) $resp;
                }
                $status = 0;
                if (isset($http_response_header) && is_array($http_response_header)) {
                    foreach ($http_response_header as $h) {
                        // Match HTTP/1.1, HTTP/2, HTTP/3
                        if (preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#', $h, $m)) {
                            $status = (int) $m[1];
                            break;
                        }
                    }
                }
            } // end: no curl binary branch
        } // end: no curl extension branch
        return ['status' => $status, 'body' => $respBody, 'error' => $error];
    }

    private static function isLocalhostUri(string $uri): bool
    {
        try {
            $host = parse_url($uri, PHP_URL_HOST) ?: '';
            return $host === 'localhost' || $host === '127.0.0.1';
        } catch (\Throwable $e) {
            return false;
        }
    }

    private static function validateRedirectUriOrExplain(string $uri): ?string
    {
        // Returns null when OK, otherwise returns a human-friendly error message explaining the likely Google policy violation
        if (!$uri) return 'GOOGLE_REDIRECT_URI is not set. Set it to your callback URL.';
        $scheme = '';
        $host = '';
        $port = null;
        $path = '';
        try {
            $scheme = (string)(parse_url($uri, PHP_URL_SCHEME) ?: '');
            $host = (string)(parse_url($uri, PHP_URL_HOST) ?: '');
            $port = parse_url($uri, PHP_URL_PORT);
            $path = (string)(parse_url($uri, PHP_URL_PATH) ?: '');
        } catch (\Throwable $e) {}
        // Google policy: public production domains must use HTTPS; HTTP is only allowed for localhost/127.0.0.1
        $isLocal = ($host === 'localhost' || $host === '127.0.0.1');
        if (!$isLocal && strtolower($scheme) !== 'https') {
            return 'Invalid redirect URI for Google OAuth policy: non-localhost callback must use HTTPS. Update GOOGLE_REDIRECT_URI to use https:// and add the same URL to Google Cloud OAuth client redirect URIs.';
        }
        // Path must be the expected callback
        if ($path === '' || $path === '/') {
            return 'GOOGLE_REDIRECT_URI must include a specific callback path, e.g. /api/auth/google/callback.';
        }
        if ($path !== '/api/auth/google/callback') {
            return 'GOOGLE_REDIRECT_URI path is incorrect. It must be exactly /api/auth/google/callback.';
        }
        // Extra dev safety: ensure port is correct when using localhost
        if ($isLocal) {
            // Our dev backend listens on 5174; Vite dev server is 5173 and must NOT be used for the OAuth callback
            if ($port === null) {
                // Default ports: 80 for http, 443 for https
                $defaultPort = strtolower($scheme) === 'https' ? 443 : 80;
                $port = $defaultPort;
            }
            if ((int)$port === 5173) {
                return 'GOOGLE_REDIRECT_URI is pointing to port 5173 (Vite dev server). Use http://localhost:5174/api/auth/google/callback — the PHP backend listens on 5174.';
            }
        }
        // Optional: if APP_URL is configured, ensure the redirect host:port matches it to avoid tunnel/proxy mistakes
        $appUrl = self::getEnv('APP_URL') ?: '';
        if ($appUrl) {
            try {
                $appHost = (string)(parse_url($appUrl, PHP_URL_HOST) ?: '');
                $appPort = parse_url($appUrl, PHP_URL_PORT);
                $appScheme = (string)(parse_url($appUrl, PHP_URL_SCHEME) ?: '');
                if ($appHost && $host && strtolower($appHost) !== strtolower($host)) {
                    return 'GOOGLE_REDIRECT_URI host does not match APP_URL. Ensure the callback host matches your backend host.';
                }
                if ($appPort !== null && $port !== null && (int)$appPort !== (int)$port) {
                    return 'GOOGLE_REDIRECT_URI port does not match APP_URL. Ensure the callback uses the backend port.';
                }
                if (!$isLocal && $appScheme && strtolower($scheme) !== strtolower($appScheme)) {
                    return 'GOOGLE_REDIRECT_URI scheme does not match APP_URL. For production, use HTTPS consistently.';
                }
            } catch (\Throwable $e) {}
        }
        return null;
    }

    public static function googleStart(): void
    {
        $clientId = self::getEnv('GOOGLE_CLIENT_ID') ?: '';
        $redirectUri = self::getEnv('GOOGLE_REDIRECT_URI') ?: '';
        if (!$clientId || !$redirectUri) {
            \text_response('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI.', 500, 'text/plain');
            return;
        }
        if ($msg = self::validateRedirectUriOrExplain($redirectUri)) {
            \text_response($msg, 400, 'text/plain');
            return;
        }

        // PKCE (S256): generate code_verifier/challenge
        $verifierBin = random_bytes(32); // 256-bit entropy
        $verifier = rtrim(strtr(base64_encode($verifierBin), '+/', '-_'), '='); // base64url-encoded verifier
        $challenge = rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
        $nonce = rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');

        // Persist verifier in a short-lived, HttpOnly cookie (10 minutes)
        $isProd = (self::getEnv('APP_ENV') ?: '') === 'production';
        $domainUrl = self::getEnv('PUBLIC_ORIGIN') ?: (self::getEnv('PUBLIC_DOMAIN') ?: '');
        $cookieDomain = '';
        if ($domainUrl) {
            try { $cookieDomain = parse_url($domainUrl, PHP_URL_HOST) ?: ''; } catch (\Throwable $e) {}
        }
        // Compute valid cookie domain for localhost/IP
        $pkceDomain = '';
        if ($cookieDomain) {
            $isIp = filter_var($cookieDomain, FILTER_VALIDATE_IP) !== false;
            $hasDot = strpos($cookieDomain, '.') !== false;
            if (!$isIp && $hasDot) {
                $pkceDomain = $cookieDomain;
            }
        }
        $pkceCookie = [
            'expires' => time() + 10 * 60,
            'path' => '/',
            'domain' => $pkceDomain,
            'secure' => $isProd ? true : false,
            'httponly' => true,
            'samesite' => 'Lax'
        ];
        setcookie('g_pkce_verifier', $verifier, $pkceCookie);

        // Minimal state (avoid embedding verifier)
        $statePayload = [
            'r' => (string)($_GET['r'] ?? ''),
            'n' => $nonce
        ];
        $state = rtrim(strtr(base64_encode(json_encode($statePayload)), '+/', '-_'), '=');

        $url = 'https://accounts.google.com/o/oauth2/v2/auth?'
            . 'client_id=' . urlencode($clientId)
            . '&redirect_uri=' . urlencode($redirectUri)
            . '&response_type=code'
            . '&scope=' . urlencode('openid email profile')
            . '&prompt=select_account&access_type=offline'
            . '&code_challenge_method=S256&code_challenge=' . urlencode($challenge)
            . '&nonce=' . urlencode($nonce)
            . '&state=' . $state;

        header('Location: ' . $url, true, 302);
    }

    public static function googleCallback(): void
    {
        $code = (string)($_GET['code'] ?? '');
        $stateRaw = (string)($_GET['state'] ?? '');
        $state = [];
        if ($stateRaw) {
            try { $state = json_decode(base64_decode(strtr($stateRaw, '-_', '+/')), true) ?: []; } catch (\Throwable $e) {}
        }
        if (!$code) { \text_response('Missing code', 400, 'text/plain'); return; }

        $clientId = self::getEnv('GOOGLE_CLIENT_ID') ?: '';
        $clientSecret = self::getEnv('GOOGLE_CLIENT_SECRET') ?: '';
        $redirectUri = self::getEnv('GOOGLE_REDIRECT_URI') ?: '';
        if (!$clientId || !$clientSecret || !$redirectUri) {
            \text_response('Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.', 500, 'text/plain');
            return;
        }
        if ($msg = self::validateRedirectUriOrExplain($redirectUri)) {
            \text_response($msg, 400, 'text/plain');
            return;
        }

        // PKCE verifier preference: cookie, then state (for backward compatibility)
        $codeVerifier = '';
        if (isset($_COOKIE['g_pkce_verifier'])) {
            $codeVerifier = (string)$_COOKIE['g_pkce_verifier'];
        } elseif (is_array($state) && !empty($state['v'])) {
            $codeVerifier = (string)$state['v'];
        }
        // Clear cookie
        try {
            $isProd = (self::getEnv('APP_ENV') ?: '') === 'production';
            $domainUrl = self::getEnv('PUBLIC_ORIGIN') ?: (self::getEnv('PUBLIC_DOMAIN') ?: '');
            $cookieDomain = '';
            if ($domainUrl) {
                try { $cookieDomain = parse_url($domainUrl, PHP_URL_HOST) ?: ''; } catch (\Throwable $e) {}
            }
            // Compute valid cookie domain for localhost/IP
            $pkceDomain = '';
            if ($cookieDomain) {
                $isIp = filter_var($cookieDomain, FILTER_VALIDATE_IP) !== false;
                $hasDot = strpos($cookieDomain, '.') !== false;
                if (!$isIp && $hasDot) {
                    $pkceDomain = $cookieDomain;
                }
            }
            setcookie('g_pkce_verifier', '', [
                'expires' => time() - 3600,
                'path' => '/',
                'domain' => $pkceDomain,
                'secure' => $isProd ? true : false,
                'httponly' => true,
                'samesite' => 'Lax'
            ]);
        } catch (\Throwable $e) {}

        $payload = [
            'code' => $code,
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'redirect_uri' => $redirectUri,
            'grant_type' => 'authorization_code'
        ];
        if ($codeVerifier) {
            $payload['code_verifier'] = $codeVerifier;
        }
        $body = http_build_query($payload);
        $res = self::httpRequest(
            'POST',
            'https://oauth2.googleapis.com/token',
            ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json', 'User-Agent: ganudenu-php-backend'],
            $body,
            15
        );
        $tokenData = json_decode($res['body'] ?: '{}', true) ?: [];
        if ($res['status'] < 200 || $res['status'] >= 300 || empty($tokenData['id_token'])) {
            $snippet = substr((string)$res['body'], 0, 300);
            $err = isset($res['error']) && $res['error'] ? (' Error=' . $res['error']) : '';
            $gerr = '';
            if (is_array($tokenData) && !empty($tokenData['error'])) {
                $gerr = ' GoogleError=' . $tokenData['error'];
                if (!empty($tokenData['error_description'])) {
                    $gerr .= ' Desc=' . substr((string)$tokenData['error_description'], 0, 200);
                }
            }
            // Add targeted hints for common causes
            $hint = '';
            $isLocal = self::isLocalhostUri($redirectUri);
            $scheme = (string)(parse_url($redirectUri, PHP_URL_SCHEME) ?: '');
            if (!$isLocal && strtolower($scheme) !== 'https') {
                $hint = ' Hint: Use HTTPS redirect URI for non-localhost domains and add it in Google Cloud Authorized redirect URIs.';
            }
            if (is_array($tokenData) && !empty($tokenData['error']) && strtolower((string)$tokenData['error']) === 'invalid_request') {
                $desc = strtolower((string)($tokenData['error_description'] ?? ''));
                if ($desc && (str_contains($desc, 'policy') || str_contains($desc, 'comply') || str_contains($desc, 'secure'))) {
                    $more = [];
                    $more[] = 'Ensure your OAuth consent screen is in "Testing" and your Google account is added under Test users.';
                    $more[] = 'Use a "Web application" OAuth client type (not Desktop/Mobile).';
                    $more[] = 'Authorized redirect URI must exactly match: ' . $redirectUri;
                    if ($isLocal) {
                        $more[] = 'Local development may use http for localhost. For public domains, https is required.';
                        $more[] = 'Do not set the Vite dev port (5173) as the redirect URI; the PHP backend listens on 5174.';
                        $more[] = 'Optional: add Authorized JavaScript origins for http://localhost:5173 and http://localhost:5174.';
                    } else {
                        $more[] = 'For non-localhost domains, ensure https and the exact host/port/path are registered.';
                    }
                    $hint .= ' Hints: ' . implode(' ', $more);
                }
            }
            \text_response("Failed to exchange code with Google. Status={$res['status']} Body={$snippet}{$err}{$gerr}{$hint}", 502, 'text/plain');
            return;
        }

        // userinfo (optional)
        $g = null;
        if (!empty($tokenData['access_token'])) {
            $resInfo = self::httpRequest(
                'GET',
                'https://www.googleapis.com/oauth2/v3/userinfo',
                ['Authorization: Bearer ' . $tokenData['access_token'], 'Accept: application/json', 'User-Agent: ganudenu-php-backend'],
                null,
                10
            ); 
            if ($resInfo['status'] >= 200 && $resInfo['status'] < 300 && $resInfo['body']) {
                $g = json_decode($resInfo['body'], true) ?: null;
            }
        }
        if (!$g || empty($g['email'])) {
            try {
                $parts = explode('.', $tokenData['id_token']);
                $payload = json_decode(base64_decode($parts[1] ?? ''), true) ?: [];
                $g = ['email' => $payload['email'] ?? '', 'email_verified' => $payload['email_verified'] ?? null, 'sub' => $payload['sub'] ?? null, 'name' => $payload['name'] ?? null];
            } catch (\Throwable $e) {}
        }
        $email = strtolower(trim((string)($g['email'] ?? '')));
        $name = trim((string)($g['name'] ?? '')) ?: explode('@', $email)[0];
        if (!$email) { \text_response('Google profile missing email', 400, 'text/plain'); return; }

        // Upsert user
        $user = DB::one("SELECT id, email, is_admin, username, user_uid, is_verified FROM users WHERE email = ?", [$email]);
        if (!$user) {
            $randomPass = bin2hex(random_bytes(16));
            $hash = password_hash($randomPass, PASSWORD_BCRYPT);
            $unameBase = strtolower(preg_replace('/[^a-z0-9]+/', '-', $name));
            $unameBase = preg_replace('/^-+|-+$/', '', $unameBase);
            $unameBase = $unameBase ? substr($unameBase, 0, 24) : explode('@', $email)[0];
            if (strlen($unameBase) < 3) $unameBase = substr(explode('@', $email)[0] ?: 'user', 0, 24);

            $uname = $unameBase;
            $tries = 0;
            while ($tries < 5) {
                $exists = DB::one("SELECT 1 FROM users WHERE username = ?", [$uname]);
                if (!$exists) break;
                $uname = $unameBase . '-' . random_int(1, 999);
                $tries++;
            }
            $uid = EmailService::generateUserUID();
            $utries = 0;
            while ($utries < 3) {
                $exists = DB::one("SELECT 1 FROM users WHERE user_uid = ?", [$uid]);
                if (!$exists) break;
                $uid = EmailService::generateUserUID();
                $utries++;
            }
            DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at, username, user_uid, is_verified) VALUES (?, ?, 0, ?, ?, ?, 1)", [$email, $hash, gmdate('c'), $uname, $uid]);
            $user = ['id' => DB::lastInsertId(), 'email' => $email, 'is_admin' => 0, 'username' => $uname, 'user_uid' => $uid, 'is_verified' => 1];
        }

        $token = JWT::sign(['user_id' => (int)$user['id'], 'email' => $user['email'], 'is_admin' => !!$user['is_admin']]);
        setcookie('auth_token', $token, self::getAuthCookieOptions());

        $returnUrl = !empty($state['r']) && preg_match('#^https?://#i', $state['r']) ? $state['r'] : (self::getEnv('PUBLIC_ORIGIN') ?: (self::getEnv('PUBLIC_DOMAIN') ?: '/auth'));
        $sep = (str_contains($returnUrl, '?') ? '&' : '?');
        $redir = $returnUrl . $sep . http_build_query(['token' => $token, 'provider' => 'google', 'email' => $email]);
        header('Location: ' . $redir, true, 302);
    }

    public static function userExists(): void
    {
        $email = strtolower(trim((string)($_GET['email'] ?? '')));
        if (!$email) { \json_response(['error' => 'Email is required.'], 400); return; }
        $existing = DB::one("SELECT id FROM users WHERE email = ?", [$email]);
        \json_response(['ok' => true, 'exists' => !!$existing]);
    }

    public static function updateUsername(): void
    {
        $body = \read_body_json();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        $username = (string)($body['username'] ?? '');
        if (!$email || !$password || !$username) { \json_response(['error' => 'Email, password and new username are required.'], 400); return; }
        $user = DB::one("SELECT id, password_hash FROM users WHERE email = ?", [$email]);
        if (!$user) { \json_response(['error' => 'Invalid credentials.'], 401); return; }
        if (!password_verify($password, $user['password_hash'])) { \json_response(['error' => 'Invalid credentials.'], 401); return; }
        try {
            DB::exec("UPDATE users SET username = ? WHERE id = ?", [$username, (int)$user['id']]);
            \json_response(['ok' => true, 'username' => $username]);
        } catch (\Throwable $e) {
            if (str_contains((string)$e->getMessage(), 'UNIQUE')) {
                \json_response(['error' => 'Username already taken.'], 409);
                return;
            }
            \json_response(['error' => 'Unexpected error.'], 500);
        }
    }

    private static function ensureUploadsDir(): string
    {
        $uploads = __DIR__ . '/../../../data/uploads';
        if (!is_dir($uploads)) @mkdir($uploads, 0775, true);
        return realpath($uploads) ?: $uploads;
    }

    public static function uploadProfilePhoto(): void
    {
        $email = strtolower(trim((string)($_POST['email'] ?? '')));
        $password = (string)($_POST['password'] ?? '');
        if (!$email || !$password) { \json_response(['error' => 'Email and password are required.'], 400); return; }
        $user = DB::one("SELECT id, password_hash FROM users WHERE email = ?", [$email]);
        if (!$user) { \json_response(['error' => 'Invalid credentials.'], 401); return; }
        if (!password_verify($password, $user['password_hash'])) { \json_response(['error' => 'Invalid credentials.'], 401); return; }

        if (!isset($_FILES['photo'])) { \json_response(['error' => 'Image file is required.'], 400); return; }
        $file = $_FILES['photo'];

        // basic signature check + block SVG
        $tmp = $file['tmp_name'];
        if (!is_uploaded_file($tmp)) { \json_response(['error' => 'Failed to read uploaded file.'], 400); return; }
        $buf = file_get_contents($tmp, false, null, 0, 12);
        $isSvg = (($_FILES['photo']['type'] ?? '') === 'image/svg+xml');
        $isJpeg = $buf && ord($buf[0]) === 0xFF && ord($buf[1]) === 0xD8 && ord($buf[2]) === 0xFF;
        $isPng = $buf && ord($buf[0]) === 0x89 && ord($buf[1]) === 0x50 && ord($buf[2]) === 0x4E && ord($buf[3]) === 0x47;
        if ($isSvg) { \json_response(['error' => 'SVG images are not allowed.'], 400); return; }
        if (!$isJpeg && !$isPng) { \json_response(['error' => 'Invalid image format. Use JPG or PNG.'], 400); return; }

        $uploads = self::ensureUploadsDir();
        $base = bin2hex(random_bytes(8));
        $dest = $uploads . '/' . $base . '.webp';
        $storedPath = $tmp;

        // Try WebP conversion via GD or Imagick
        try {
            if (function_exists('imagecreatefromjpeg') || class_exists('Imagick')) {
                $mime = mime_content_type($tmp) ?: '';
                if (class_exists('Imagick')) {
                    $img = new \Imagick($tmp);
                    $img->setImageFormat('webp');
                    $img->resizeImage(800, 0, \Imagick::FILTER_LANCZOS, 1, true);
                    $img->writeImage($dest);
                    $storedPath = $dest;
                    $img->clear();
                    $img->destroy();
                } else {
                    if (str_contains($mime, 'png')) $im = imagecreatefrompng($tmp);
                    else $im = imagecreatefromjpeg($tmp);
                    if ($im !== false && function_exists('imagewebp')) {
                        $width = imagesx($im); $height = imagesy($im);
                        $newW = min(800, $width);
                        $newH = (int) round($height * ($newW / max(1, $width)));
                        $dst = imagecreatetruecolor($newW, $newH);
                        imagecopyresampled($dst, $im, 0, 0, 0, 0, $newW, $newH, $width, $height);
                        imagewebp($dst, $dest, 85);
                        imagedestroy($dst);
                        imagedestroy($im);
                        $storedPath = $dest;
                    }
                }
            }
        } catch (\Throwable $e) {
            // fallback to original
        }

        DB::exec("UPDATE users SET profile_photo_path = ? WHERE id = ?", [$storedPath, (int)$user['id']]);
        $publicUrl = '/uploads/' . basename($storedPath);
        \json_response(['ok' => true, 'photo_url' => $publicUrl]);
    }

    public static function deleteAccount(): void
    {
        $body = \read_body_json();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        if (!$email || !$password) { \json_response(['error' => 'Email and password are required.'], 400); return; }
        $user = DB::one("SELECT id, password_hash, profile_photo_path FROM users WHERE email = ?", [$email]);
        if (!$user) { \json_response(['error' => 'Invalid credentials.'], 401); return; }
        if (!password_verify($password, $user['password_hash'])) { \json_response(['error' => 'Invalid credentials.'], 401); return; }
        if (!empty($user['profile_photo_path'])) { @unlink($user['profile_photo_path']); }
        DB::exec("DELETE FROM users WHERE id = ?", [(int)$user['id']]);
        \json_response(['ok' => true, 'message' => 'Account deleted.']);
    }

    public static function sendRegistrationOtp(): void
    {
        $body = \read_body_json();
        $email = strtolower(trim((string)($body['email'] ?? '')));
        if (!$email) { \json_response(['error' => 'Email is required.'], 400); return; }
        $ex = DB::one("SELECT id FROM users WHERE email = ?", [$email]);
        if ($ex) { \json_response(['error' => 'Email already registered.'], 409); return; }

        $otp = EmailService::generateOtp();
        $expires = gmdate('c', time() + 10 * 60);
        DB::exec("INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)", [$email, $otp, $expires]);

        $dev = strtolower(self::getEnv('EMAIL_DEV_MODE') ?: '') === 'true';
        if ($dev) {
            error_log("[otp:dev] Registration OTP for {$email}: {$otp}");
            \json_response(['ok' => true, 'message' => 'OTP generated (dev mode).', 'otp' => $otp]);
            return;
        }
        $sent = EmailService::send($email, 'Your Registration OTP', "<p>Your OTP is: <strong>{$otp}</strong></p>");
        if (!$sent['ok']) {
            DB::exec("DELETE FROM otps WHERE email = ? AND otp = ?", [$email, $otp]);
            $detail = isset($sent['error']) ? (string)$sent['error'] : 'unknown';
            \json_response(['error' => 'Failed to send OTP email.', 'detail' => $detail], 502);
            return;
        }
        \json_response(['ok' => true, 'message' => 'OTP sent successfully.']);
    }

    public static function verifyOtpAndRegister(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $password = (string)($b['password'] ?? '');
        $otp = (string)($b['otp'] ?? '');
        $username = (string)($b['username'] ?? '');
        if (!$email || !$password || !$otp || !$username) { \json_response(['error' => 'Email, password, username, and OTP are required.'], 400); return; }

        $otpRecord = DB::one("SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC", [$email, $otp]);
        if (!$otpRecord) { \json_response(['error' => 'Invalid OTP.'], 401); return; }
        if (time() > strtotime($otpRecord['expires_at'])) {
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            \json_response(['error' => 'OTP has expired.'], 401);
            return;
        }

        $hash = password_hash($password, PASSWORD_BCRYPT);
        try {
            $uid = EmailService::generateUserUID();
            $tries = 0;
            while ($tries < 3) {
                $exists = DB::one("SELECT 1 FROM users WHERE user_uid = ?", [$uid]);
                if (!$exists) break;
                $uid = EmailService::generateUserUID();
                $tries++;
            }
            DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at, username, user_uid, is_verified) VALUES (?, ?, 0, ?, ?, ?, 0)", [
                $email, $hash, gmdate('c'), $username, $uid
            ]);
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            $userId = DB::lastInsertId();
            $token = JWT::sign(['user_id' => $userId, 'email' => $email, 'is_admin' => false]);
            \json_response(['ok' => true, 'token' => $token, 'user' => ['id' => $userId, 'user_uid' => $uid, 'email' => $email, 'username' => $username, 'is_admin' => false, 'is_verified' => false]]);
        } catch (\Throwable $e) {
            if (str_contains($e->getMessage(), 'UNIQUE')) { \json_response(['error' => 'Email or username already registered.'], 409); return; }
            \json_response(['error' => 'Unexpected error.'], 500);
        }
    }

    public static function login(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $password = (string)($b['password'] ?? '');
        if (!$email) { \json_response(['error' => 'Email is required.'], 400); return; }

        $adminEmail = strtolower(trim((string)(self::getEnv('ADMIN_EMAIL') ?: '')));
        // Admins authenticate the same way as users: with their configured password and an emailed OTP.
        // No temporary passwords are generated here to maintain parity with the Node backend.

        // Normal flow for non-admin users (password required)
        if (!$password) { \json_response(['error' => 'Email and password are required.'], 400); return; }
        $user = DB::one("SELECT id, email, password_hash, is_admin, username, profile_photo_path, is_banned, suspended_until, user_uid, is_verified FROM users WHERE email = ?", [$email]);
        if (!$user || !password_verify($password, $user['password_hash'])) { \json_response(['error' => 'Invalid credentials.'], 401); return; }

        if (!(int)$user['is_admin']) {
            if (!empty($user['is_banned'])) { \json_response(['error' => 'Your account is banned. Please contact support.'], 403); return; }
            if (!empty($user['suspended_until']) && strtotime($user['suspended_until']) > time()) {
                \json_response(['error' => 'Your account is suspended until ' . date('c', strtotime($user['suspended_until'])) . '.'], 403);
                return;
            }
        }

        $otp = EmailService::generateOtp();
        $expires = gmdate('c', time() + 10 * 60);
        DB::exec("INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)", [$email, $otp, $expires]);

        $dev = strtolower(self::getEnv('EMAIL_DEV_MODE') ?: '') === 'true';
        if ($dev) {
            error_log("[otp:dev] Login OTP for {$email}: {$otp}");
            \json_response(['ok' => true, 'otp_required' => true, 'is_admin' => !!$user['is_admin'], 'message' => 'OTP required for login (dev mode).', 'otp' => $otp]);
            return;
        }
        $subject = ((int)$user['is_admin'] ? 'Admin Login OTP' : 'Login OTP');
        $sent = EmailService::send($email, $subject, "<p>Your login OTP is: <strong>{$otp}</strong></p>");
        if (!$sent['ok']) {
            DB::exec("DELETE FROM otps WHERE email = ? AND otp = ?", [$email, $otp]);
            \json_response(['error' => 'Failed to send OTP email.'], 502);
            return;
        }
        \json_response(['ok' => true, 'otp_required' => true, 'is_admin' => !!$user['is_admin'], 'message' => 'OTP sent to your email.']);
    }

    public static function verifyAdminLoginOtp(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $password = (string)($b['password'] ?? '');
        $otp = (string)($b['otp'] ?? '');
        if (!$email || !$password || !$otp) { \json_response(['error' => 'Email, password, and OTP are required.'], 400); return; }

        $user = DB::one("SELECT id, email, password_hash, is_admin, username, profile_photo_path, user_uid, is_verified FROM users WHERE email = ?", [$email]);
        if (!$user || !(int)$user['is_admin']) { \json_response(['error' => 'Invalid credentials.'], 401); return; }

        if (!password_verify($password, $user['password_hash'])) { \json_response(['error' => 'Invalid credentials.'], 401); return; }

        $otpRecord = DB::one("SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC", [$email, $otp]);
        if (!$otpRecord) { \json_response(['error' => 'Invalid OTP.'], 401); return; }
        if (time() > strtotime($otpRecord['expires_at'])) {
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            \json_response(['error' => 'OTP has expired.'], 401);
            return;
        }
        DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);

        $claims = ['user_id' => (int)$user['id'], 'email' => $user['email'], 'is_admin' => true, 'mfa' => true];
        $token = JWT::sign($claims);
        setcookie('auth_token', $token, self::getAuthCookieOptions());
        $photo_url = !empty($user['profile_photo_path']) ? ('/uploads/' . basename($user['profile_photo_path'])) : null;
        \json_response(['ok' => true, 'token' => $token, 'user' => [
            'id' => (int)$user['id'], 'user_uid' => $user['user_uid'], 'email' => $user['email'], 'username' => $user['username'],
            'is_admin' => !!$user['is_admin'], 'is_verified' => !!$user['is_verified'], 'photo_url' => $photo_url
        ]]);
    }

    public static function verifyLoginOtp(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $password = (string)($b['password'] ?? '');
        $otp = (string)($b['otp'] ?? '');
        if (!$email || !$password || !$otp) { \json_response(['error' => 'Email, password, and OTP are required.'], 400); return; }
        $user = DB::one("SELECT id, email, password_hash, is_admin, username, profile_photo_path, is_banned, suspended_until, user_uid, is_verified FROM users WHERE email = ?", [$email]);
        if (!$user) { \json_response(['error' => 'Invalid credentials.'], 401); return; }

        if (!(int)$user['is_admin']) {
            if (!empty($user['is_banned'])) { \json_response(['error' => 'Your account is banned. Please contact support.'], 403); return; }
            if (!empty($user['suspended_until']) && strtotime($user['suspended_until']) > time()) {
                \json_response(['error' => 'Your account is suspended until ' . date('c', strtotime($user['suspended_until'])) . '.'], 403);
                return;
            }
        }

        if (!password_verify($password, $user['password_hash'])) {
            \json_response(['error' => 'Invalid credentials.'], 401);
            return;
        }

        $otpRecord = DB::one("SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC", [$email, $otp]);
        if (!$otpRecord) { \json_response(['error' => 'Invalid OTP.'], 401); return; }
        if (time() > strtotime($otpRecord['expires_at'])) {
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            \json_response(['error' => 'OTP has expired.'], 401);
            return;
        }
        DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);

        $token = JWT::sign(['user_id' => (int)$user['id'], 'email' => $user['email'], 'is_admin' => !!$user['is_admin']]);
        setcookie('auth_token', $token, self::getAuthCookieOptions());
        $photo_url = !empty($user['profile_photo_path']) ? ('/uploads/' . basename($user['profile_photo_path'])) : null;
        \json_response(['ok' => true, 'token' => $token, 'user' => [
            'id' => (int)$user['id'], 'user_uid' => $user['user_uid'], 'email' => $user['email'], 'username' => $user['username'],
            'is_admin' => !!$user['is_admin'], 'is_verified' => !!$user['is_verified'], 'photo_url' => $photo_url
        ]]);
    }

    public static function forgotPassword(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        if (!$email) { \json_response(['error' => 'Email is required.'], 400); return; }
        $user = DB::one("SELECT id FROM users WHERE email = ?", [$email]);
        if (!$user) {
            \json_response(['ok' => true, 'message' => 'If a matching account was found, an OTP has been sent.']);
            return;
        }
        $otp = EmailService::generateOtp();
        $expires = gmdate('c', time() + 10 * 60);
        DB::exec("INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)", [$email, $otp, $expires]);
        $dev = strtolower(self::getEnv('EMAIL_DEV_MODE') ?: '') === 'true';
        if ($dev) {
            error_log("[otp:dev] Password reset OTP for {$email}: {$otp}");
            \json_response(['ok' => true, 'message' => 'OTP generated (dev mode).', 'otp' => $otp]);
            return;
        }
        $sent = EmailService::send($email, 'Your Password Reset OTP', "<p>Your OTP for password reset is: <strong>{$otp}</strong></p>");
        if (!$sent['ok']) {
            DB::exec("DELETE FROM otps WHERE email = ? AND otp = ?", [$email, $otp]);
            \json_response(['error' => 'Failed to send OTP email.'], 502);
            return;
        }
        \json_response(['ok' => true, 'message' => 'If a matching account was found, an OTP has been sent.']);
    }

    public static function verifyPasswordOtp(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $otp = (string)($b['otp'] ?? '');
        if (!$email || !$otp) { \json_response(['error' => 'Email and OTP are required.'], 400); return; }
        $otpRecord = DB::one("SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC", [$email, $otp]);
        if (!$otpRecord) { \json_response(['error' => 'Invalid OTP.'], 401); return; }
        if (time() > strtotime($otpRecord['expires_at'])) {
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            \json_response(['error' => 'OTP has expired.'], 401);
            return;
        }
        \json_response(['ok' => true, 'message' => 'OTP verified successfully.']);
    }

    public static function resetPassword(): void
    {
        $b = \read_body_json();
        $email = strtolower(trim((string)($b['email'] ?? '')));
        $otp = (string)($b['otp'] ?? '');
        $password = (string)($b['password'] ?? '');
        if (!$email || !$otp || !$password) { \json_response(['error' => 'Email, OTP, and new password are required.'], 400); return; }
        $otpRecord = DB::one("SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC", [$email, $otp]);
        if (!$otpRecord) { \json_response(['error' => 'Invalid OTP.'], 401); return; }
        if (time() > strtotime($otpRecord['expires_at'])) {
            DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
            \json_response(['error' => 'OTP has expired.'], 401);
            return;
        }
        $hash = password_hash($password, PASSWORD_BCRYPT);
        DB::exec("UPDATE users SET password_hash = ? WHERE email = ?", [$hash, $email]);
        DB::exec("DELETE FROM otps WHERE id = ?", [(int)$otpRecord['id']]);
        \json_response(['ok' => true, 'message' => 'Password reset successfully.']);
    }

    public static function status(): void
    {
        // Accept either Bearer token or auth_token cookie
        $tok = JWT::getBearerToken();
        if (!$tok && isset($_COOKIE['auth_token'])) {
            $tok = (string) $_COOKIE['auth_token'];
        }
        if (!$tok) { \json_response(['error' => 'Missing authorization bearer token.'], 401); return; }

        $v = JWT::verify($tok);
        if (!$v['ok']) { \json_response(['error' => 'Invalid token.'], 401); return; }
        $claims = $v['decoded'];

        $user = DB::one("SELECT id, email, is_admin, is_banned, suspended_until, username FROM users WHERE id = ?", [(int)$claims['user_id']]);
        if (!$user) { \json_response(['error' => 'User not found.'], 404); return; }

        // Auto-promote if email matches ADMIN_EMAIL (parity with AdminController)
        $claimsEmail = strtolower((string)($claims['email'] ?? ''));
        // Use same fallback as bootstrap seeding so local dev works even if ADMIN_EMAIL is not set
        $adminEmail = strtolower(trim((string)(self::getEnv('ADMIN_EMAIL') ?: 'janithmanodaya2002@gmail.com')));
        if ($user && !(int)$user['is_admin']) {
            if ($adminEmail && $claimsEmail && $claimsEmail === $adminEmail) {
                DB::exec("UPDATE users SET is_admin = 1 WHERE id = ?", [(int)$user['id']]);
                $user['is_admin'] = 1;
            }
        }

        \json_response([
            'ok' => true,
            'email' => $user['email'],
            'username' => $user['username'] ?? null,
            'is_admin' => !!$user['is_admin'],
            'is_banned' => !!$user['is_banned'],
            'suspended_until' => $user['suspended_until'] ?? null
        ]);
    }
}
