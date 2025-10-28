<?php
require __DIR__ . '/../app/bootstrap.php';

cors_allow();

/**
 * Optional route override for hosts without rewrite rules.
 * If a request is sent to /api/index.php?r=/api/XYZ, use the provided path for routing.
 * This allows frontend to call /api/index.php with the desired route in the r query param.
 */
if (isset($_GET['r']) && is_string($_GET['r'])) {
    $override = $_GET['r'];
    $p = parse_url($override, PHP_URL_PATH) ?: '/';
    // Sanitize and only allow /api/* or /uploads/* overrides
    if (str_starts_with($p, '/api/') || str_starts_with($p, '/uploads/')) {
        // Override REQUEST_URI for downstream static serving and router
        $_SERVER['REQUEST_URI'] = $p;
        // Also adjust QUERY_STRING if the override contains a query part
        $q = parse_url($override, PHP_URL_QUERY) ?: '';
        $_SERVER['QUERY_STRING'] = $q;
    }
}

// Dev/static: serve /uploads/* from configured UPLOADS_PATH (env) or default to ../../data/uploads with long cache headers
$pathOnlyStatic = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if (preg_match('#^/uploads/(.+)$#', $pathOnlyStatic, $m)) {
    $rel = $m[1];
    // Block path traversal
    if (str_contains($rel, '..')) {
        http_response_code(400);
        echo 'Bad request';
        exit;
    }
    $uploadsBase = getenv('UPLOADS_PATH');
    if (!$uploadsBase || !is_dir($uploadsBase)) {
        $uploadsBase = realpath(__DIR__ . '/../../data/uploads');
    }
    $file = $uploadsBase ? realpath(rtrim($uploadsBase, '/\\') . '/' . $rel) : false;
    if ($file && is_file($file)) {
        $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        $ct = 'application/octet-stream';
        if ($ext === 'webp') $ct = 'image/webp';
        elseif ($ext === 'jpg' || $ext === 'jpeg') $ct = 'image/jpeg';
        elseif ($ext === 'png') $ct = 'image/png';
        elseif ($ext === 'gif') $ct = 'image/gif';
        elseif ($ext === 'avif') $ct = 'image/avif';
        header('Content-Type: ' . $ct);
        header('Cache-Control: public, max-age=31536000, immutable');
        readfile($file);
        exit;
    } else {
        http_response_code(404);
        echo 'Not found';
        exit;
    }
}

$router = new \App\Router();

// Top-level redirects to /api/auth/google/*
$router->add('GET', '/auth/google/start', function () {
    $qs = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] ? ('?' . $_SERVER['QUERY_STRING']) : '';
    header('Location: /api/auth/google/start' . $qs, true, 302);
});
$router->add('GET', '/auth/google/callback', function () {
    $qs = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] ? ('?' . $_SERVER['QUERY_STRING']) : '';
    header('Location: /api/auth/google/callback' . $qs, true, 302);
});

// Build and register dynamic routes from minimap
\App\Services\MiniMap::buildIfNeeded();
\App\Services\AutoRoutes::registerRoutes($router);

// Maintenance gate: allow admin, health, maintenance status; else block with 503 and optional HTML
function is_admin_request(): bool {
    $tok = \App\Services\JWT::getBearerToken();
    if (!$tok) return false;
    $v = \App\Services\JWT::verify($tok);
    if (!$v['ok']) return false;
    $claims = $v['decoded'];
    $row = \App\Services\DB::one("SELECT id, email, is_admin FROM users WHERE id = ?", [(int)$claims['user_id']]);
    if (!$row || !(int)$row['is_admin']) return false;
    return strtolower($row['email']) === strtolower($claims['email']);
}
function get_maintenance_config(): array {
    try {
        $row = \App\Services\DB::one("SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1");
        return ['enabled' => !!($row && $row['maintenance_mode']), 'message' => $row['maintenance_message'] ?? ''];
    } catch (\Throwable $e) {
        return ['enabled' => false, 'message' => ''];
    }
}

$pathOnly = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$m = get_maintenance_config();
if ($m['enabled']) {
    if (!(str_starts_with($pathOnly, '/api/admin') || $pathOnly === '/api/health' || $pathOnly === '/api/maintenance-status' || is_admin_request())) {
        if (str_starts_with($pathOnly, '/api/')) {
            json_response(['error' => 'Service under maintenance', 'message' => $m['message']], 503);
            exit;
        }
        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
        $html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Maintenance - Ganudenu</title><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head><body><h1>We’re performing maintenance</h1><p>Ganudenu is temporarily unavailable while we upgrade our systems.</p><p>If you are an administrator, manage maintenance from the <a href=\"{$domain}/admin\">Admin Panel</a>.</p></body></html>";
        header('Content-Type: text/html'); http_response_code(503); echo $html; exit;
    }
}

// Dispatch
$router->dispatch();