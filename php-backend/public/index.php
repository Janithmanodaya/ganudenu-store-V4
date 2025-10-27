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

// Public static
$router->add('GET', '/robots.txt', fn() => \App\Controllers\StaticController::robots());
$router->add('GET', '/sitemap.xml', fn() => \App\Controllers\StaticController::sitemap());

// Health
$router->add('GET', '/api/health', function () {
    json_response(['ok' => true, 'service' => 'ganudenu.store', 'ts' => gmdate('c')]);
}, ['rate_group' => 'GLOBAL']);

// Banners
$router->add('GET', '/api/banners', fn() => \App\Controllers\StaticController::banners(), ['rate_group' => 'GLOBAL']);

// Maintenance
$router->add('GET', '/api/maintenance-status', fn() => \App\Controllers\StaticController::maintenanceStatus(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/maintenance-status/stream', fn() => \App\Controllers\StaticController::maintenanceStream());

// --- Auth group ---
$router->add('GET', '/api/auth/google/start', fn() => \App\Controllers\AuthController::googleStart(), ['rate_group' => 'AUTH']);
$router->add('GET', '/api/auth/google/callback', fn() => \App\Controllers\AuthController::googleCallback(), ['rate_group' => 'AUTH']);
$router->add('GET', '/api/auth/google/debug', fn() => \App\Controllers\AuthController::googleDebug(), ['rate_group' => 'AUTH']);
$router->add('GET', '/api/auth/user-exists', fn() => \App\Controllers\AuthController::userExists(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/update-username', fn() => \App\Controllers\AuthController::updateUsername(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/upload-profile-photo', fn() => \App\Controllers\AuthController::uploadProfilePhoto(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/delete-account', fn() => \App\Controllers\AuthController::deleteAccount(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/send-registration-otp', fn() => \App\Controllers\AuthController::sendRegistrationOtp(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/verify-otp-and-register', fn() => \App\Controllers\AuthController::verifyOtpAndRegister(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/login', fn() => \App\Controllers\AuthController::login(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/verify-admin-login-otp', fn() => \App\Controllers\AuthController::verifyAdminLoginOtp(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/verify-login-otp', fn() => \App\Controllers\AuthController::verifyLoginOtp(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/forgot-password', fn() => \App\Controllers\AuthController::forgotPassword(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/verify-password-otp', fn() => \App\Controllers\AuthController::verifyPasswordOtp(), ['rate_group' => 'AUTH']);
$router->add('POST', '/api/auth/reset-password', fn() => \App\Controllers\AuthController::resetPassword(), ['rate_group' => 'AUTH']);
$router->add('GET', '/api/auth/status', fn() => \App\Controllers\AuthController::status(), ['rate_group' => 'GLOBAL']);

// Jobs (Employee Profile)
$router->add('POST', '/api/jobs/employee/draft', fn() => \App\Controllers\JobsController::employeeDraft(), ['rate_group' => 'LISTINGS']);

// Notifications
$router->add('GET', '/api/notifications/', fn() => \App\Controllers\NotificationsController::list(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/notifications/unread-count', fn() => \App\Controllers\NotificationsController::unreadCount(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/notifications/:id/read', fn($p) => \App\Controllers\NotificationsController::markRead($p), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/notifications/saved-searches', fn() => \App\Controllers\NotificationsController::savedSearchCreate(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/notifications/saved-searches', fn() => \App\Controllers\NotificationsController::savedSearchList(), ['rate_group' => 'GLOBAL']);
$router->add('DELETE', '/api/notifications/saved-searches/:id', fn($p) => \App\Controllers\NotificationsController::savedSearchDelete($p), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/notifications/saved-searches/notify-for-listing', fn() => \App\Controllers\NotificationsController::savedSearchNotifyForListing(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/notifications/unread-count/stream', fn() => \App\Controllers\NotificationsController::unreadStream());

// Users
$router->add('GET', '/api/users/profile', fn() => \App\Controllers\UsersController::profileGet(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/users/profile', fn() => \App\Controllers\UsersController::profilePost(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/users/rate', fn() => \App\Controllers\UsersController::rate(), ['rate_group' => 'GLOBAL']);

// Listings
$router->add('POST', '/api/listings/draft', fn() => \App\Controllers\ListingsController::draft(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/draft/:id', fn($p) => \App\Controllers\ListingsController::draftGet($p), ['rate_group' => 'LISTINGS']);
$router->add('DELETE', '/api/listings/draft/:id', fn($p) => \App\Controllers\ListingsController::draftDelete($p), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/submit', fn() => \App\Controllers\ListingsController::submit(), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/describe', fn() => \App\Controllers\ListingsController::describe(), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/vehicle-specs', fn() => \App\Controllers\ListingsController::vehicleSpecs(), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/draft/:id/images', fn($p) => \App\Controllers\ListingsController::draftImageAdd($p), ['rate_group' => 'LISTINGS']);
$router->add('DELETE', '/api/listings/draft/:id/images/:imageId', fn($p) => \App\Controllers\ListingsController::draftImageDelete($p), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/', fn() => \App\Controllers\ListingsController::list(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/search', fn() => \App\Controllers\ListingsController::search(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/filters', fn() => \App\Controllers\ListingsController::filters(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/suggestions', fn() => \App\Controllers\ListingsController::suggestions(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/similar', fn() => \App\Controllers\ListingsController::similar([]), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/my', fn() => \App\Controllers\ListingsController::my(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/my-drafts', fn() => \App\Controllers\ListingsController::myDrafts(), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/:id', fn($p) => \App\Controllers\ListingsController::get($p), ['rate_group' => 'LISTINGS']);
$router->add('DELETE', '/api/listings/:id', fn($p) => \App\Controllers\ListingsController::delete($p), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/:id/report', fn($p) => \App\Controllers\ListingsController::report($p), ['rate_group' => 'LISTINGS']);
$router->add('GET', '/api/listings/payment-info/:id', fn($p) => \App\Controllers\ListingsController::paymentInfo($p), ['rate_group' => 'LISTINGS']);
$router->add('POST', '/api/listings/payment-note', fn() => \App\Controllers\ListingsController::paymentNote(), ['rate_group' => 'LISTINGS']);

// Admin
$router->add('GET', '/api/admin/env-status', fn() => \App\Controllers\AdminController::envStatus(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/config', fn() => \App\Controllers\AdminController::configGet(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/config', fn() => \App\Controllers\AdminController::configPost(), ['rate_group' => 'ADMIN']);
// Secure-config management
$router->add('GET', '/api/admin/config-secure/status', fn() => \App\Controllers\AdminController::configSecureStatus(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/config-secure/decrypt', fn() => \App\Controllers\AdminController::configSecureDecrypt(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/config-secure/encrypt', fn() => \App\Controllers\AdminController::configSecureEncrypt(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/prompts', fn() => \App\Controllers\AdminController::promptsGet(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/prompts', fn() => \App\Controllers\AdminController::promptsPost(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/pending', fn() => \App\Controllers\AdminController::pendingList(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/pending/:id', fn($p) => \App\Controllers\AdminController::pendingGet($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/pending/:id/update', fn($p) => \App\Controllers\AdminController::pendingUpdate($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/pending/:id/approve', fn($p) => \App\Controllers\AdminController::pendingApprove($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/pending/:id/reject', fn($p) => \App\Controllers\AdminController::pendingReject($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/pending/approve_many', fn() => \App\Controllers\AdminController::pendingApproveMany(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/banners', fn() => \App\Controllers\AdminController::bannersList(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/banners', fn() => \App\Controllers\AdminController::bannersUpload(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/banners/:id/active', fn($p) => \App\Controllers\AdminController::bannersActive($p), ['rate_group' => 'ADMIN']);
$router->add('DELETE', '/api/admin/banners/:id', fn($p) => \App\Controllers\AdminController::bannersDelete($p), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/maintenance', fn() => \App\Controllers\AdminController::maintenanceGet(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/maintenance', fn() => \App\Controllers\AdminController::maintenancePost(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/test-gemini', fn() => \App\Controllers\AdminController::testGemini(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/metrics', fn() => \App\Controllers\AdminController::metrics(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/admin/users', fn() => \App\Controllers\AdminController::usersList(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/verify', fn($p) => \App\Controllers\AdminController::userVerify($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/ban', fn($p) => \App\Controllers\AdminController::userBan($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/unban', fn($p) => \App\Controllers\AdminController::userUnban($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/suspend7', fn($p) => \App\Controllers\AdminController::userSuspend7($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/suspend', fn($p) => \App\Controllers\AdminController::userSuspend($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/users/:id/unsuspend', fn($p) => \App\Controllers\AdminController::userUnsuspend($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/backup', fn() => \App\Controllers\AdminController::backup(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/restore', fn() => \App\Controllers\AdminController::restore(), ['rate_group' => 'ADMIN']);
// Admin: flag listing
$router->add('POST', '/api/admin/flag', fn() => \App\Controllers\AdminController::flag(), ['rate_group' => 'ADMIN']);

// Admin notifications
$router->add('GET', '/api/admin/notifications', fn() => \App\Controllers\AdminController::notificationsList(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/notifications', fn() => \App\Controllers\AdminController::notificationsCreate(), ['rate_group' => 'ADMIN']);
$router->add('DELETE', '/api/admin/notifications/:id', fn($p) => \App\Controllers\AdminController::notificationsDelete($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/notifications/digests/saved-search', fn() => \App\Controllers\NotificationDigestController::savedSearchDigest(), ['rate_group' => 'ADMIN']);

// Admin reports
$router->add('GET', '/api/admin/reports', fn() => \App\Controllers\AdminController::reportsList(), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/reports/:id/resolve', fn($p) => \App\Controllers\AdminController::reportResolve($p), ['rate_group' => 'ADMIN']);
$router->add('DELETE', '/api/admin/reports/:id', fn($p) => \App\Controllers\AdminController::reportDelete($p), ['rate_group' => 'ADMIN']);

// Admin listing management
$router->add('GET', '/api/admin/users/:id/listings', fn($p) => \App\Controllers\AdminController::userListings($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/admin/listings/:id/urgent', fn($p) => \App\Controllers\AdminController::listingUrgent($p), ['rate_group' => 'ADMIN']);
$router->add('DELETE', '/api/admin/listings/:id', fn($p) => \App\Controllers\AdminController::listingDelete($p), ['rate_group' => 'ADMIN']);

// Wanted
$router->add('POST', '/api/wanted/', fn() => \App\Controllers\WantedController::create(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/wanted/', fn() => \App\Controllers\WantedController::list(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/wanted/my', fn() => \App\Controllers\WantedController::my(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/wanted/:id/close', fn($p) => \App\Controllers\WantedController::close($p), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/wanted/respond', fn() => \App\Controllers\WantedController::respond(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/wanted/notify-for-listing', fn() => \App\Controllers\WantedController::notifyForListing(), ['rate_group' => 'GLOBAL']);

// Chats
$router->add('GET', '/api/chats/', fn() => \App\Controllers\ChatsController::list(), ['rate_group' => 'GLOBAL']);
$router->add('POST', '/api/chats/', fn() => \App\Controllers\ChatsController::send(), ['rate_group' => 'GLOBAL']);
$router->add('GET', '/api/chats/admin/conversations', fn() => \App\Controllers\ChatsController::adminConversations(), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/chats/admin/:email', fn($p) => \App\Controllers\ChatsController::adminFetch($p), ['rate_group' => 'ADMIN']);
$router->add('POST', '/api/chats/admin/:email', fn($p) => \App\Controllers\ChatsController::adminSend($p), ['rate_group' => 'ADMIN']);
$router->add('GET', '/api/chats/stream', fn() => \App\Controllers\ChatsController::userStream());
$router->add('GET', '/api/chats/admin/:email/stream', fn($p) => \App\Controllers\ChatsController::adminStream($p), ['rate_group' => 'ADMIN']);

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