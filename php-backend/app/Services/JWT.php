<?php
namespace App\Services;

class JWT
{
    private static ?string $secret = null;

    private static function loadSecret(): string
    {
        if (self::$secret !== null) return self::$secret;
        $env = getenv('JWT_SECRET') ?: '';
        if ($env) {
            self::$secret = $env;
            return self::$secret;
        }
        // Try data/jwt-secret.txt (parity with Node)
        $path = __DIR__ . '/../../../data/jwt-secret.txt';
        if (is_file($path)) {
            $val = trim((string) @file_get_contents($path));
            if ($val) {
                self::$secret = $val;
                return self::$secret;
            }
        }
        $rnd = 'dev-secret-' . bin2hex(random_bytes(16));
        @mkdir(dirname($path), 0775, true);
        @file_put_contents($path, $rnd);
        self::$secret = $rnd;
        return self::$secret;
    }

    public static function sign(array $claims, string $expiresIn = null): string
    {
        $secret = self::loadSecret();
        $header = ['typ' => 'JWT', 'alg' => 'HS256'];
        $now = time();
        $expSpec = $expiresIn ?: (getenv('JWT_EXPIRES_IN') ?: '7d');
        // parse expires (simple days/hours)
        $exp = $now + 7 * 24 * 60 * 60;
        if (preg_match('/^(\d+)d$/', $expSpec, $m)) $exp = $now + ((int)$m[1]) * 86400;
        elseif (preg_match('/^(\d+)h$/', $expSpec, $m)) $exp = $now + ((int)$m[1]) * 3600;

        $payload = $claims + ['exp' => $exp, 'iat' => $now];

        $b64 = function ($data) {
            return rtrim(strtr(base64_encode(json_encode($data)), '+/', '-_'), '=');
        };
        $toSign = $b64($header) . '.' . $b64($payload);
        $sig = rtrim(strtr(base64_encode(hash_hmac('sha256', $toSign, $secret, true)), '+/', '-_'), '=');
        return $toSign . '.' . $sig;
    }

    public static function verify(string $token): array
    {
        $secret = self::loadSecret();
        $parts = explode('.', $token);
        if (count($parts) !== 3) return ['ok' => false, 'error' => 'malformed'];
        [$h, $p, $s] = $parts;
        $calc = rtrim(strtr(base64_encode(hash_hmac('sha256', "$h.$p", $secret, true)), '+/', '-_'), '=');
        if (!hash_equals($calc, $s)) return ['ok' => false, 'error' => 'signature'];
        $json = json_decode(base64_decode(strtr($p, '-_', '+/')), true);
        if (!is_array($json)) return ['ok' => false, 'error' => 'payload'];
        if (isset($json['exp']) && time() >= (int)$json['exp']) return ['ok' => false, 'error' => 'expired'];
        return ['ok' => true, 'decoded' => $json];
    }

    public static function getBearerToken(): ?string
    {
        $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        if ($hdr) {
            $parts = explode(' ', $hdr);
            if (count($parts) === 2 && strcasecmp($parts[0], 'Bearer') === 0) return $parts[1];
        }
        $cookie = $_COOKIE['auth_token'] ?? null;
        if ($cookie) return $cookie;
        // Parse raw cookie header
        $rawCookie = $_SERVER['HTTP_COOKIE'] ?? '';
        foreach (explode(';', $rawCookie) as $it) {
            $pair = explode('=', trim($it), 2);
            if (count($pair) === 2 && $pair[0] === 'auth_token') {
                return urldecode($pair[1]);
            }
        }
        return null;
    }
}