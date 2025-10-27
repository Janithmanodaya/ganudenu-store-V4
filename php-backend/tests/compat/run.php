<?php
/**
 * Compatibility test runner.
 * Usage: php run.php http://localhost:8080 fixtures.json
 * fixtures.json contains:
 * [
 *   { "name": "Health", "method": "GET", "url": "/api/health", "expect": { "status": 200, "jsonKeys": ["ok","service","ts"] } },
 *   ...
 * ]
 */
if ($argc < 3) { fwrite(STDERR, "Usage: php run.php <baseUrl> <fixtures.json>\n"); exit(1); }
$base = rtrim($argv[1], '/');
$fixturesFile = $argv[2];
$fixtures = json_decode(file_get_contents($fixturesFile), true);
if (!is_array($fixtures)) { fwrite(STDERR, "Invalid fixtures file.\n"); exit(1); }

function httpRequest(string $method, string $url, array $opts = []): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HEADER => true,
    ]);
    if (!empty($opts['body'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($opts['body']) ? $opts['body'] : json_encode($opts['body']));
        $hdrs = $opts['headers'] ?? [];
        if (!isset($hdrs['Content-Type'])) $hdrs['Content-Type'] = 'application/json';
        $lines = [];
        foreach ($hdrs as $k => $v) $lines[] = $k . ': ' . $v;
        curl_setopt($ch, CURLOPT_HTTPHEADER, $lines);
    } elseif (!empty($opts['headers'])) {
        $lines = [];
        foreach ($opts['headers'] as $k => $v) $lines[] = $k . ': ' . $v;
        curl_setopt($ch, CURLOPT_HTTPHEADER, $lines);
    }
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    $headersRaw = substr($resp, 0, $headerSize);
    $body = substr($resp, $headerSize);
    $json = json_decode($body, true);
    return ['status' => $code, 'headers' => $headersRaw, 'body' => $body, 'json' => $json];
}

$failures = 0;
foreach ($fixtures as $f) {
    $name = $f['name'] ?? '';
    $method = strtoupper($f['method'] ?? 'GET');
    $url = $base . ($f['url'] ?? '/');
    $expect = $f['expect'] ?? [];
    $resp = httpRequest($method, $url, ['headers' => ($f['headers'] ?? []), 'body' => ($f['body'] ?? null)]);
    $ok = true;
    if (isset($expect['status']) && (int)$expect['status'] !== (int)$resp['status']) $ok = false;
    if (isset($expect['jsonKeys']) && is_array($expect['jsonKeys'])) {
        foreach ($expect['jsonKeys'] as $k) {
            if (!is_array($resp['json']) || !array_key_exists($k, $resp['json'])) $ok = false;
        }
    }
    if (!$ok) {
        $failures++;
        echo "[FAIL] {$name}: expected " . json_encode($expect) . " got status {$resp['status']} body: {$resp['body']}\n";
    } else {
        echo "[OK] {$name}\n";
    }
}
echo "Failures: {$failures}\n";
exit($failures > 0 ? 1 : 0);