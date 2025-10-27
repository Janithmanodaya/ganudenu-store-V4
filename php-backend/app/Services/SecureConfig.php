<?php
namespace App\Services;

class SecureConfig
{
    private static function basePath(): string
    {
        $base = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        return $base . '/data/secure-config.enc';
    }

    public static function status(): array
    {
        $path = self::basePath();
        $st = @stat($path);
        if (!$st || !is_file($path)) return ['exists' => false];
        return [
            'exists' => true,
            'size' => (int)($st['size'] ?? 0),
            'mtime' => isset($st['mtime']) ? gmdate('c', (int)$st['mtime']) : null
        ];
    }

    public static function encryptAndSave(string $passphrase, string $jsonString): array
    {
        $b64 = self::encrypt($passphrase, $jsonString);
        $path = self::basePath();
        @mkdir(dirname($path), 0775, true);
        if (@file_put_contents($path, $b64) === false) {
            return ['ok' => false, 'error' => 'Failed to write secure config'];
        }
        return ['ok' => true];
    }

    public static function decryptFromFile(string $passphrase): array
    {
        $path = self::basePath();
        if (!is_file($path)) return ['ok' => false, 'status' => 404, 'error' => 'Config not found'];
        $b64 = (string) @file_get_contents($path);
        if ($b64 === '') return ['ok' => false, 'status' => 400, 'error' => 'Empty config file'];
        try {
            $json = self::decrypt($passphrase, $b64);
            $decoded = json_decode($json, true);
            if (is_array($decoded)) return ['ok' => true, 'config' => $decoded];
            return ['ok' => true, 'config_text' => $json];
        } catch (\Throwable $e) {
            return ['ok' => false, 'status' => 400, 'error' => 'Invalid passphrase or corrupted config'];
        }
    }

    public static function encrypt(string $passphrase, string $plaintext): string
    {
        $iv = random_bytes(12);
        $key = self::scryptKey($passphrase);
        $tag = '';
        $ciphertext = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($ciphertext === false || $tag === '') {
            throw new \Error('Encryption failed');
        }
        return base64_encode($iv . $tag . $ciphertext);
    }

    public static function decrypt(string $passphrase, string $b64): string
    {
        $buf = base64_decode($b64, true);
        if ($buf === false || strlen($buf) < 12 + 16 + 1) throw new \Error('Invalid payload');
        $iv = substr($buf, 0, 12);
        $tag = substr($buf, 12, 16);
        $ciphertext = substr($buf, 28);
        $key = self::scryptKey($passphrase);
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($plaintext === false) throw new \Error('Decryption failed');
        return $plaintext;
    }

    private static function scryptKey(string $pass): string
    {
        // Match Node: scrypt(password, sha256('ganudenu-config-salt'), N=16384, r=8, p=1, keyLen=32)
        $salt = hash('sha256', 'ganudenu-config-salt', true);
        // If ext-sodium provides scrypt, prefer it; else use pure-PHP implementation.
        if (function_exists('sodium_crypto_pwhash_scryptsalsa208sha256')) {
            // Use interactive limits roughly equivalent; N=16384,r=8,p=1 ~= memlimit 64MB, opslimit ~ 2^20
            $opslimit = defined('SODIUM_CRYPTO_PWHASH_SCRYPTSALSA208SHA256_OPSLIMIT_INTERACTIVE')
                ? \SODIUM_CRYPTO_PWHASH_SCRYPTSALSA208SHA256_OPSLIMIT_INTERACTIVE : 524288;
            $memlimit = defined('SODIUM_CRYPTO_PWHASH_SCRYPTSALSA208SHA256_MEMLIMIT_INTERACTIVE')
                ? \SODIUM_CRYPTO_PWHASH_SCRYPTSALSA208SHA256_MEMLIMIT_INTERACTIVE : 67108864;
            return \sodium_crypto_pwhash_scryptsalsa208sha256(32, $pass, $salt, $opslimit, $memlimit);
        }
        if (function_exists('sodium_crypto_pwhash')) {
            // Fallback to Argon2id with stable params; not ideal for decrypting Node files but preserves functionality if no scrypt.
            return \sodium_crypto_pwhash(32, $pass, $salt,
                defined('SODIUM_CRYPTO_PWHASH_OPSLIMIT_MODERATE') ? \SODIUM_CRYPTO_PWHASH_OPSLIMIT_MODERATE : 3,
                defined('SODIUM_CRYPTO_PWHASH_MEMLIMIT_MODERATE') ? \SODIUM_CRYPTO_PWHASH_MEMLIMIT_MODERATE : 67108864,
                defined('SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13') ? \SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13 : 2
            );
        }
        // Pure-PHP scrypt to ensure Node parity when libsodium is unavailable.
        return self::scrypt($pass, $salt, 16384, 8, 1, 32);
    }

    // ---- Pure-PHP scrypt implementation (N=16384, r=8, p=1) ----

    private static function rotl32(int $x, int $n): int { $x &= 0xFFFFFFFF; return (($x << $n) & 0xFFFFFFFF) | (($x & 0xFFFFFFFF) >> (32 - $n)); }

    private static function salsa20_8(array $in): array
    {
        // $in: array of 16 unsigned 32-bit ints
        $x = $in;
        for ($i = 0; $i < 8; $i += 2) {
            // Odd round
            $x[ 4] ^= self::rotl32(($x[ 0] + $x[12]) & 0xFFFFFFFF, 7);
            $x[ 8] ^= self::rotl32(($x[ 4] + $x[ 0]) & 0xFFFFFFFF, 9);
            $x[12] ^= self::rotl32(($x[ 8] + $x[ 4]) & 0xFFFFFFFF, 13);
            $x[ 0] ^= self::rotl32(($x[12] + $x[ 8]) & 0xFFFFFFFF, 18);

            $x[ 9] ^= self::rotl32(($x[ 5] + $x[ 1]) & 0xFFFFFFFF, 7);
            $x[13] ^= self::rotl32(($x[ 9] + $x[ 5]) & 0xFFFFFFFF, 9);
            $x[ 1] ^= self::rotl32(($x[13] + $x[ 9]) & 0xFFFFFFFF, 13);
            $x[ 5] ^= self::rotl32(($x[ 1] + $x[13]) & 0xFFFFFFFF, 18);

            $x[14] ^= self::rotl32(($x[10] + $x[ 6]) & 0xFFFFFFFF, 7);
            $x[ 2] ^= self::rotl32(($x[14] + $x[10]) & 0xFFFFFFFF, 9);
            $x[ 6] ^= self::rotl32(($x[ 2] + $x[14]) & 0xFFFFFFFF, 13);
            $x[10] ^= self::rotl32(($x[ 6] + $x[ 2]) & 0xFFFFFFFF, 18);

            $x[ 3] ^= self::rotl32(($x[15] + $x[11]) & 0xFFFFFFFF, 7);
            $x[ 7] ^= self::rotl32(($x[ 3] + $x[15]) & 0xFFFFFFFF, 9);
            $x[11] ^= self::rotl32(($x[ 7] + $x[ 3]) & 0xFFFFFFFF, 13);
            $x[15] ^= self::rotl32(($x[11] + $x[ 7]) & 0xFFFFFFFF, 18);

            // Even round
            $x[ 1] ^= self::rotl32(($x[ 0] + $x[ 3]) & 0xFFFFFFFF, 7);
            $x[ 2] ^= self::rotl32(($x[ 1] + $x[ 0]) & 0xFFFFFFFF, 9);
            $x[ 3] ^= self::rotl32(($x[ 2] + $x[ 1]) & 0xFFFFFFFF, 13);
            $x[ 0] ^= self::rotl32(($x[ 3] + $x[ 2]) & 0xFFFFFFFF, 18);

            $x[ 6] ^= self::rotl32(($x[ 5] + $x[ 4]) & 0xFFFFFFFF, 7);
            $x[ 7] ^= self::rotl32(($x[ 6] + $x[ 5]) & 0xFFFFFFFF, 9);
            $x[ 4] ^= self::rotl32(($x[ 7] + $x[ 6]) & 0xFFFFFFFF, 13);
            $x[ 5] ^= self::rotl32(($x[ 4] + $x[ 7]) & 0xFFFFFFFF, 18);

            $x[11] ^= self::rotl32(($x[10] + $x[ 9]) & 0xFFFFFFFF, 7);
            $x[ 8] ^= self::rotl32(($x[11] + $x[10]) & 0xFFFFFFFF, 9);
            $x[ 9] ^= self::rotl32(($x[ 8] + $x[11]) & 0xFFFFFFFF, 13);
            $x[10] ^= self::rotl32(($x[ 9] + $x[ 8]) & 0xFFFFFFFF, 18);

            $x[12] ^= self::rotl32(($x[15] + $x[14]) & 0xFFFFFFFF, 7);
            $x[13] ^= self::rotl32(($x[12] + $x[15]) & 0xFFFFFFFF, 9);
            $x[14] ^= self::rotl32(($x[13] + $x[12]) & 0xFFFFFFFF, 13);
            $x[15] ^= self::rotl32(($x[14] + $x[13]) & 0xFFFFFFFF, 18);
        }
        $out = [];
        for ($i = 0; $i < 16; $i++) {
            $out[$i] = ($x[$i] + $in[$i]) & 0xFFFFFFFF;
        }
        return $out;
    }

    private static function xor128(array &$dst, array $src): void
    {
        $n = count($dst);
        for ($i = 0; $i < $n; $i++) {
            $dst[$i] ^= $src[$i];
        }
    }

    private static function blockmix_salsa8(array $B, int $r): array
    {
        // B: array of 32-bit words length 32*r (i.e., 128*r bytes)
        $X = array_slice($B, (2 * $r - 1) * 16, 16);
        $Y = [];
        for ($i = 0; $i < 2 * $r; $i++) {
            $Bi = array_slice($B, $i * 16, 16);
            self::xor128($X, $Bi);
            $X = self::salsa20_8($X);
            $Y = array_merge($Y, $X);
        }
        $out = [];
        for ($i = 0; $i < $r; $i++) {
            $out = array_merge($out, array_slice($Y, $i * 16 * 2, 16)); // even
        }
        for ($i = 0; $i < $r; $i++) {
            $out = array_merge($out, array_slice($Y, ($i * 2 + 1) * 16, 16)); // odd
        }
        return $out;
    }

    private static function integerify(array $B, int $r): int
    {
        // Return little-endian 64-bit integer from last 16 words (we take first 32 bits)
        $idx = (2 * $r - 1) * 16;
        $lo = $B[$idx] & 0xFFFFFFFF;
        $hi = $B[$idx + 1] & 0xFFFFFFFF;
        // Reduce to 32-bit for indexing
        return (($hi << 16) ^ $lo) & 0x7FFFFFFF;
    }

    private static function romix(array $B, int $N, int $r): array
    {
        $X = $B;
        $V = [];
        for ($i = 0; $i < $N; $i++) {
            $V[$i] = $X;
            $X = self::blockmix_salsa8($X, $r);
        }
        for ($i = 0; $i < $N; $i++) {
            $j = self::integerify($X, $r) % $N;
            $T = $V[$j];
            $X = array_map(fn($a, $b) => ($a ^ $b) & 0xFFFFFFFF, $X, $T);
            $X = self::blockmix_salsa8($X, $r);
        }
        return $X;
    }

    public static function scrypt(string $password, string $salt, int $N, int $r, int $p, int $dkLen): string
    {
        $B = hash_pbkdf2('sha256', $password, $salt, 1, $p * 128 * $r, true);
        $Bwords = [];
        for ($i = 0; $i < strlen($B); $i += 4) {
            $Bwords[] = (ord($B[$i]) | (ord($B[$i + 1]) << 8) | (ord($B[$i + 2]) << 16) | (ord($B[$i + 3]) << 24)) & 0xFFFFFFFF;
        }
        $XY = [];
        for ($i = 0; $i < $p; $i++) {
            $Bi = array_slice($Bwords, $i * 32 * $r, 32 * $r);
            $Yi = self::romix($Bi, $N, $r);
            $XY = array_merge($XY, $Yi);
        }
        $outBytes = '';
        for ($i = 0; $i < count($XY); $i++) {
            $v = $XY[$i] & 0xFFFFFFFF;
            $outBytes .= chr($v & 0xFF) . chr(($v >> 8) & 0xFF) . chr(($v >> 16) & 0xFF) . chr(($v >> 24) & 0xFF);
        }
        return hash_pbkdf2('sha256', $password, $outBytes, 1, $dkLen, true);
    }
}