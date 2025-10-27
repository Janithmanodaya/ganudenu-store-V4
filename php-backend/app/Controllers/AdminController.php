<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\FacebookPoster;

class AdminController
{
    public static function envStatus(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;

        $mask = function (?string $s): ?string {
            $val = trim((string)($s ?? ''));
            if ($val === '') return null;
            if (strlen($val) <= 8) return '****';
            return substr($val, 0, 4) . '••••' . substr($val, -4);
        };

        $env = [
            'APP_ENV' => getenv('APP_ENV') ?: null,
            'APP_DEBUG' => getenv('APP_DEBUG') ?: null,
            'APP_URL' => getenv('APP_URL') ?: null,

            'DB_PATH' => getenv('DB_PATH') ?: null,

            'JWT_SECRET_set' => (getenv('JWT_SECRET') ? true : false),
            'JWT_EXPIRES_IN' => getenv('JWT_EXPIRES_IN') ?: null,

            'PUBLIC_ORIGIN' => getenv('PUBLIC_ORIGIN') ?: null,
            'PUBLIC_DOMAIN' => getenv('PUBLIC_DOMAIN') ?: null,
            'CORS_ORIGINS' => getenv('CORS_ORIGINS') ?: null,

            'GOOGLE_CLIENT_ID_masked' => $mask(getenv('GOOGLE_CLIENT_ID') ?: null),
            'GOOGLE_CLIENT_SECRET_masked' => $mask(getenv('GOOGLE_CLIENT_SECRET') ?: null),
            'GOOGLE_REDIRECT_URI' => getenv('GOOGLE_REDIRECT_URI') ?: null,

            'EMAIL_DEV_MODE' => getenv('EMAIL_DEV_MODE') ?: null,
            'SMTP_HOST' => getenv('SMTP_HOST') ?: null,
            'SMTP_PORT' => getenv('SMTP_PORT') ?: null,
            'SMTP_SECURE' => getenv('SMTP_SECURE') ?: null,
            'SMTP_USER_masked' => $mask(getenv('SMTP_USER') ?: null),
            'SMTP_PASS_set' => (getenv('SMTP_PASS') ? true : false),
            'SMTP_FROM' => getenv('SMTP_FROM') ?: null,
            'BREVO_API_KEY_set' => (getenv('BREVO_API_KEY') ? true : false),
            'BREVO_LOGIN_masked' => $mask(getenv('BREVO_LOGIN') ?: null),

            'FB_SERVICE_URL' => getenv('FB_SERVICE_URL') ?: null,
            'FB_SERVICE_API_KEY_set' => (getenv('FB_SERVICE_API_KEY') ? true : false),

            'GEMINI_API_KEY_masked' => $mask(getenv('GEMINI_API_KEY') ?: null),

            'RATE_GLOBAL_MAX' => getenv('RATE_GLOBAL_MAX') ?: null,
            'RATE_GLOBAL_WINDOW_MS' => getenv('RATE_GLOBAL_WINDOW_MS') ?: null,
            'RATE_AUTH_MAX' => getenv('RATE_AUTH_MAX') ?: null,
            'RATE_AUTH_WINDOW_MS' => getenv('RATE_AUTH_WINDOW_MS') ?: null,
            'RATE_ADMIN_MAX' => getenv('RATE_ADMIN_MAX') ?: null,
            'RATE_ADMIN_WINDOW_MS' => getenv('RATE_ADMIN_WINDOW_MS') ?: null,
            'RATE_LISTINGS_MAX' => getenv('RATE_LISTINGS_MAX') ?: null,
            'RATE_LISTINGS_WINDOW_MS' => getenv('RATE_LISTINGS_WINDOW_MS') ?: null,

            'TRUST_PROXY_HOPS' => getenv('TRUST_PROXY_HOPS') ?: null,
        ];

        \json_response(['ok' => true, 'env' => $env]);
    }
    private static function requireAdmin(): ?array
    {
        $tok = JWT::getBearerToken();
        if (!$tok && isset($_COOKIE['auth_token'])) {
            $tok = (string) $_COOKIE['auth_token'];
        }
        if (!$tok) { \json_response(['error' => 'Missing authorization token'], 401); return null; }
        $v = JWT::verify($tok);
        if (!$v['ok']) { \json_response(['error' => 'Invalid token'], 401); return null; }
        $claims = $v['decoded'];
        $row = DB::one("SELECT id, email, is_admin FROM users WHERE id = ?", [(int)$claims['user_id']]);

        $claimsEmail = strtolower((string)($claims['email'] ?? ''));
        $adminEmail = strtolower(trim((string)(getenv('ADMIN_EMAIL') ?: '')));
        $claimsIsAdmin = !empty($claims['is_admin']);

        // If DB record missing, create it from claims
        if (!$row && $claimsEmail) {
            DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)", [
                $claimsEmail,
                password_hash(bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
                ($claimsIsAdmin || ($adminEmail && $claimsEmail === $adminEmail)) ? 1 : 0,
                gmdate('c')
            ]);
            $row = DB::one("SELECT id, email, is_admin FROM users WHERE email = ?", [$claimsEmail]);
        }

        // Promote to admin if either:
        //  - token claims is_admin=true (admin login flow), or
        //  - email matches ADMIN_EMAIL
        if ($row && !(int)$row['is_admin']) {
            if ($claimsIsAdmin || ($adminEmail && $claimsEmail === $adminEmail)) {
                DB::exec("UPDATE users SET is_admin = 1 WHERE id = ?", [(int)$row['id']]);
                $row['is_admin'] = 1;
            }
        }

        if (!$row || !(int)$row['is_admin']) { \json_response(['error' => 'Forbidden'], 403); return null; }
        if (strtolower($row['email']) !== $claimsEmail) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['id' => (int)$row['id'], 'email' => strtolower($row['email'])];
    }

    private static function requireAdmin2FA(): ?array
    {
        $tok = JWT::getBearerToken();
        if (!$tok && isset($_COOKIE['auth_token'])) {
            $tok = (string) $_COOKIE['auth_token'];
        }
        if (!$tok) { \json_response(['error' => 'Missing authorization token'], 401); return null; }
        $v = JWT::verify($tok);
        if (!$v['ok']) { \json_response(['error' => 'Invalid token'], 401); return null; }
        $claims = $v['decoded'];
        if (empty($claims['mfa'])) { \json_response(['error' => 'Admin 2FA required'], 401); return null; }

        $claimsEmail = strtolower((string)($claims['email'] ?? ''));
        $adminEmail = strtolower(trim((string)(getenv('ADMIN_EMAIL') ?: '')));

        $row = DB::one("SELECT id, email, is_admin FROM users WHERE id = ?", [(int)$claims['user_id']]);
        if (!$row && $claimsEmail) {
            DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)", [
                $claimsEmail,
                password_hash(bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
                ($adminEmail && $claimsEmail === $adminEmail) ? 1 : 0,
                gmdate('c')
            ]);
            $row = DB::one("SELECT id, email, is_admin FROM users WHERE email = ?", [$claimsEmail]);
        }
        if ($row && !(int)$row['is_admin']) {
            if ($adminEmail && $claimsEmail === $adminEmail) {
                DB::exec("UPDATE users SET is_admin = 1 WHERE id = ?", [(int)$row['id']]);
                $row['is_admin'] = 1;
            }
        }

        if (!$row || !(int)$row['is_admin']) { \json_response(['error' => 'Forbidden'], 403); return null; }
        if (strtolower($row['email']) !== $claimsEmail) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['id' => (int)$row['id'], 'email' => strtolower($row['email'])];
    }

    public static function configGet(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        try {
            $row = DB::one("
              SELECT bank_details, whatsapp_number, email_on_approve, maintenance_mode, maintenance_message,
                     bank_account_number, bank_account_name, bank_name
              FROM admin_config WHERE id = 1
            ") ?: [];
            $rules = DB::all("SELECT category, amount, enabled FROM payment_rules ORDER BY category ASC");
            $mask = null;
            $key = getenv('GEMINI_API_KEY') ?: '';
            if ($key) { $mask = (strlen($key) <= 8) ? '****' : (substr($key, 0, 4) . '••••' . substr($key, -4)); }
            \json_response([
                'bank_details' => $row['bank_details'] ?? '',
                'bank_account_number' => $row['bank_account_number'] ?? '',
                'bank_account_name' => $row['bank_account_name'] ?? '',
                'bank_name' => $row['bank_name'] ?? '',
                'whatsapp_number' => $row['whatsapp_number'] ?? '',
                'email_on_approve' => !!($row['email_on_approve'] ?? 0),
                'maintenance_mode' => !!($row['maintenance_mode'] ?? 0),
                'maintenance_message' => $row['maintenance_message'] ?? '',
                'payment_rules' => $rules,
                'secrets_managed' => true,
                'gemini_api_key_masked' => $mask
            ]);
        } catch (\Throwable $e) {
            \json_response([
                'bank_details' => '',
                'bank_account_number' => '',
                'bank_account_name' => '',
                'bank_name' => '',
                'whatsapp_number' => '',
                'email_on_approve' => false,
                'maintenance_mode' => false,
                'maintenance_message' => '',
                'payment_rules' => [],
                'secrets_managed' => true,
                'gemini_api_key_masked' => null
            ]);
        }
    }

    public static function configPost(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $bankDetails = isset($b['bankDetails']) ? (string)$b['bankDetails'] : null;
        $whatsappNumber = isset($b['whatsappNumber']) ? (string)$b['whatsappNumber'] : null;
        $emailOnApprove = isset($b['emailOnApprove']) ? ($b['emailOnApprove'] ? 1 : 0) : null;
        $maintenanceMode = isset($b['maintenanceMode']) ? ($b['maintenanceMode'] ? 1 : 0) : null;
        $maintenanceMessage = array_key_exists('maintenanceMessage', $b) ? (string)$b['maintenanceMessage'] : null;
        $bankAccountNumber = isset($b['bankAccountNumber']) ? (string)$b['bankAccountNumber'] : null;
        $bankAccountName = isset($b['bankAccountName']) ? (string)$b['bankAccountName'] : null;
        $bankName = isset($b['bankName']) ? (string)$b['bankName'] : null;

        $row = DB::one("SELECT id FROM admin_config WHERE id = 1");
        if (!$row) DB::exec("INSERT INTO admin_config (id) VALUES (1)");
        DB::exec("
          UPDATE admin_config
          SET bank_details = COALESCE(?, bank_details),
              whatsapp_number = COALESCE(?, whatsapp_number),
              email_on_approve = COALESCE(?, email_on_approve),
              maintenance_mode = COALESCE(?, maintenance_mode),
              maintenance_message = COALESCE(?, maintenance_message),
              bank_account_number = COALESCE(?, bank_account_number),
              bank_account_name = COALESCE(?, bank_account_name),
              bank_name = COALESCE(?, bank_name)
          WHERE id = 1
        ", [$bankDetails, $whatsappNumber, $emailOnApprove, $maintenanceMode, $maintenanceMessage, $bankAccountNumber, $bankAccountName, $bankName]);

        // payment rules
        if (!empty($b['paymentRules']) && is_array($b['paymentRules'])) {
            $up = DB::conn()->prepare("
              INSERT INTO payment_rules (category, amount, enabled) VALUES (?, ?, ?)
              ON CONFLICT(category) DO UPDATE SET amount = excluded.amount, enabled = excluded.enabled
            ");
            foreach ($b['paymentRules'] as $rule) {
                $cat = trim((string)($rule['category'] ?? ''));
                $amt = (int)($rule['amount'] ?? 0);
                $en = !empty($rule['enabled']) ? 1 : 0;
                if (!$cat || $amt < 0 || $amt > 1000000) continue;
                $up->execute([$cat, $amt, $en]);
            }
        }

        \json_response(['ok' => true]);
    }

    public static function promptsGet(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $rows = DB::all("SELECT type, content FROM prompts");
        $map = [];
        foreach ($rows as $r) { $map[$r['type']] = $r['content']; }
        \json_response($map);
    }

    public static function promptsPost(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $entries = [
            ['listing_extraction', $b['listing_extraction'] ?? null],
            ['seo_metadata', $b['seo_metadata'] ?? null],
            ['resume_extraction', $b['resume_extraction'] ?? null],
        ];
        foreach ($entries as [$type, $content]) {
            if (!is_string($content) || !trim((string)$content)) { \json_response(['error' => "Prompt \"{$type}\" is required."], 400); return; }
        }
        $upsert = DB::conn()->prepare("INSERT INTO prompts (type, content) VALUES (?, ?) ON CONFLICT(type) DO UPDATE SET content = excluded.content");
        foreach ($entries as [$type, $content]) {
            $upsert->execute([$type, trim((string)$content)]);
        }
        \json_response(['ok' => true]);
    }

    public static function pendingList(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $rows = DB::all("
          SELECT id, main_category, title, description, seo_title, seo_description, created_at, remark_number, price, owner_email
          FROM listings
          WHERE status = 'Pending Approval'
          ORDER BY created_at ASC
        ");
        \json_response(['items' => $rows]);
    }

    public static function pendingGet(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id.'], 400); return; }
        $listing = DB::one("SELECT * FROM listings WHERE id = ?", [$id]);
        if (!$listing) { \json_response(['error' => 'Listing not found.'], 404); return; }
        $images = DB::all("SELECT id, path, original_name FROM listing_images WHERE listing_id = ?", [$id]);
        $seo = $listing['seo_json'] ? json_decode($listing['seo_json'], true) : ['seo_title' => ($listing['seo_title'] ?? ''), 'meta_description' => ($listing['seo_description'] ?? ''), 'seo_keywords' => ($listing['seo_keywords'] ?? '')];
        \json_response(['listing' => $listing, 'images' => $images, 'seo' => $seo]);
    }

    public static function pendingUpdate(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $structured_json = (string)($b['structured_json'] ?? '');
        $seo_title = (string)($b['seo_title'] ?? '');
        $meta_description = (string)($b['meta_description'] ?? '');
        $seo_keywords = (string)($b['seo_keywords'] ?? '');
        if (!self::isValidJson($structured_json)) { \json_response(['error' => 'structured_json must be valid JSON.'], 400); return; }
        $st = mb_substr($seo_title, 0, 60);
        $sd = mb_substr($meta_description, 0, 160);
        $sk = $seo_keywords;
        DB::exec("
          UPDATE listings
          SET structured_json = ?, seo_title = ?, seo_description = ?, seo_keywords = ?, seo_json = ?
          WHERE id = ?
        ", [trim($structured_json), trim($st), trim($sd), trim($sk), json_encode(['seo_title' => $st, 'meta_description' => $sd, 'seo_keywords' => $sk], JSON_PRETTY_PRINT), $id]);
        DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
        DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'update', ?)", [$admin['id'], $id, gmdate('c')]);
        \json_response(['ok' => true]);
    }

    public static function pendingApprove(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE listings SET status = 'Approved', reject_reason = NULL WHERE id = ?", [$id]);
        DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
        DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'approve', ?)", [$admin['id'], $id, gmdate('c')]);

        $listing = DB::one("SELECT id, title, owner_email, main_category, remark_number FROM listings WHERE id = ?", [$id]);
        if (!empty($listing['owner_email'])) {
            DB::exec("DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'", [$id]);
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
              VALUES (?, ?, ?, ?, 'approved', ?)
            ", ['Listing Approved', 'Good news! Your ad "' . $listing['title'] . "\" (#{$id}) has been approved and is now live.", strtolower(trim((string)$listing['owner_email'])), gmdate('c'), $id]);
        }

        // Non-blocking Facebook poster call
        $fb = FacebookPoster::postApproval($listing, $admin['email']);
        if (!empty($fb['url'])) {
            DB::exec("UPDATE listings SET facebook_post_url = ? WHERE id = ?", [$fb['url'], $id]);
        }

        \json_response(['ok' => true]);
    }

    public static function pendingReject(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $reason = (string)($b['reason'] ?? '');
        if (!$reason || !trim($reason)) { \json_response(['error' => 'Reject reason is required.'], 400); return; }
        $listing = DB::one("SELECT id, title, owner_email FROM listings WHERE id = ?", [$id]);
        DB::exec("UPDATE listings SET status = 'Rejected', reject_reason = ? WHERE id = ?", [trim($reason), $id]);
        DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
        DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, reason, ts) VALUES (?, ?, 'reject', ?, ?)", [$admin['id'], $id, trim($reason), gmdate('c')]);
        if (!empty($listing['owner_email'])) {
            DB::exec("DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'", [$id]);
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
              VALUES (?, ?, ?, ?, 'rejected', ?)
            ", ['Listing Rejected', 'We’re sorry. Your ad "' . $listing['title'] . "\" (#{$id}) was rejected.\nReason: " . trim($reason), strtolower(trim((string)$listing['owner_email'])), gmdate('c'), $id]);
        }
        \json_response(['ok' => true]);
    }

    public static function pendingApproveMany(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $ids = is_array($b['ids'] ?? null) ? array_map('intval', $b['ids']) : [];
        if (empty($ids)) { \json_response(['error' => 'ids array required'], 400); return; }

        $stmt = DB::conn()->prepare("UPDATE listings SET status = 'Approved', reject_reason = NULL WHERE id = ?");
        $audit = DB::conn()->prepare("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'approve', ?)");
        $delPending = DB::conn()->prepare("DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'");
        $insApproved = DB::conn()->prepare("
          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
          VALUES (?, ?, ?, ?, 'approved', ?)
        ");

        foreach ($ids as $id) {
            $stmt->execute([$id]);
            $audit->execute([$admin['id'], $id, gmdate('c')]);
            $listing = DB::one("SELECT id, title, owner_email, main_category, remark_number FROM listings WHERE id = ?", [$id]);
            if (!empty($listing['owner_email'])) {
                $delPending->execute([$id]);
                $insApproved->execute(['Listing Approved', 'Good news! Your ad "' . $listing['title'] . "\" (#{$id}) has been approved and is now live.", strtolower(trim((string)$listing['owner_email'])), gmdate('c'), $id]);
            }
            // Fire-and-forget Facebook post
            $fb = FacebookPoster::postApproval($listing, $admin['email']);
            if (!empty($fb['url'])) {
                DB::exec("UPDATE listings SET facebook_post_url = ? WHERE id = ?", [$fb['url'], $id]);
            }
        }
        \json_response(['ok' => true]);
    }

    public static function bannersList(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        try {
            $rows = DB::all("SELECT id, path, active, sort_order, created_at FROM banners ORDER BY sort_order ASC, id DESC");
            $items = [];
            foreach ($rows as $r) {
                $filename = basename((string)($r['path'] ?? ''));
                $url = $filename ? '/uploads/' . $filename : null;
                $items[] = ['id' => (int)$r['id'], 'url' => $url, 'active' => !!$r['active'], 'sort_order' => (int)$r['sort_order'], 'created_at' => $r['created_at']];
            }
            \json_response(['results' => $items]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load banners'], 500);
        }
    }

    public static function bannersUpload(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        if (empty($_FILES['image'])) { \json_response(['error' => 'Image file required'], 400); return; }
        $f = $_FILES['image'];
        $tmp = $f['tmp_name'];
        if (!is_uploaded_file($tmp)) { \json_response(['error' => 'Failed to read uploaded file.'], 400); return; }
        $buf = file_get_contents($tmp, false, null, 0, 8);
        $isSvg = (($_FILES['image']['type'] ?? '') === 'image/svg+xml');
        $isJpeg = $buf && ord($buf[0]) === 0xFF && ord($buf[1]) === 0xD8 && ord($buf[2]) === 0xFF;
        $isPng = $buf && ord($buf[0]) === 0x89 && ord($buf[1]) === 0x50 && ord($buf[2]) === 0x4E && ord($buf[3]) === 0x47;
        if ($isSvg) { \json_response(['error' => 'SVG images are not allowed.'], 400); return; }
        if (!$isJpeg && !$isPng) { \json_response(['error' => 'Invalid image format. Use JPG or PNG.'], 400); return; }
        $uploads = __DIR__ . '/../../../data/uploads';
        if (!is_dir($uploads)) @mkdir($uploads, 0775, true);
        $storedPath = $tmp;
        try {
            if (class_exists('Imagick')) {
                $base = bin2hex(random_bytes(8));
                $webp = $uploads . '/' . $base . '.webp';
                $img = new \Imagick($tmp);
                $img->resizeImage(1200, 0, \Imagick::FILTER_LANCZOS, 1, true);
                $img->setImageFormat('webp');
                $img->writeImage($webp);
                $storedPath = $webp;
                $img->clear(); $img->destroy();
            }
        } catch (\Throwable $e) {}
        DB::exec("INSERT INTO banners (path, active, sort_order, created_at) VALUES (?, 1, 0, ?)", [$storedPath, gmdate('c')]);
        \json_response(['ok' => true]);
    }

    public static function bannersActive(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $active = !empty($b['active']) ? 1 : 0;
        DB::exec("UPDATE banners SET active = ? WHERE id = ?", [$active, $id]);
        \json_response(['ok' => true]);
    }

    public static function bannersDelete(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $row = DB::one("SELECT path FROM banners WHERE id = ?", [$id]);
        if (!empty($row['path'])) { @unlink($row['path']); }
        DB::exec("DELETE FROM banners WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function maintenanceGet(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        try {
            $row = DB::one("SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1");
            \json_response(['enabled' => !!($row && $row['maintenance_mode']), 'message' => $row['maintenance_message'] ?? '']);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load maintenance state'], 500);
        }
    }

    public static function maintenancePost(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $enabled = !empty($b['enabled']) ? 1 : 0;
        $message = array_key_exists('message', $b) ? (string)$b['message'] : null;
        $row = DB::one("SELECT id FROM admin_config WHERE id = 1");
        if (!$row) DB::exec("INSERT INTO admin_config (id) VALUES (1)");
        DB::exec("UPDATE admin_config SET maintenance_mode = ?, maintenance_message = COALESCE(?, maintenance_message) WHERE id = 1", [$enabled, $message !== null ? trim($message) : null]);
        \json_response(['ok' => true]);
    }

    public static function testGemini(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $key = getenv('GEMINI_API_KEY') ?: '';
        if (!$key) { \json_response(['error' => 'No Gemini API key configured.'], 400); return; }
        $url = 'https://generativelanguage.googleapis.com/v1/models?key=' . urlencode($key);
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 15,
                'ignore_errors' => true,
                'header' => "Accept: application/json\r\nUser-Agent: ganudenu-php-backend\r\n",
            ],
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
            ]
        ]);
        $resp = @file_get_contents($url, false, $ctx);
        $status = 0;
        if (isset($http_response_header) && is_array($http_response_header)) {
            foreach ($http_response_header as $h) {
                if (preg_match('#^HTTP/\d(?:\.\d)?\s+(\d{3})#', $h, $m)) { $status = (int)$m[1]; break; }
            }
        }
        $data = json_decode((string)$resp, true) ?: [];
        if ($status >= 200 && $status < 300) {
            $count = is_array($data['models'] ?? null) ? count($data['models']) : 0;
            \json_response(['ok' => true, 'models_count' => $count]);
        } else {
            \json_response(['ok' => false, 'error' => $data['error'] ?? $data], $status > 0 ? $status : 500);
        }
    }

    public static function metrics(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        try {
            $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $nowIso = $now->format('c');

            // Range param: days (default 14, max 60)
            $daysParam = (int)($_GET['days'] ?? 14);
            if ($daysParam <= 0) $daysParam = 14;
            if ($daysParam > 60) $daysParam = 60;

            $rangeStart = (clone $now)->setTime(0, 0, 0);
            $rangeStart = $rangeStart->sub(new \DateInterval('P' . ($daysParam - 1) . 'D'));
            $rangeStartIso = $rangeStart->format('c');

            // Totals
            $totalUsers = (int)(DB::one("SELECT COUNT(*) AS c FROM users")['c'] ?? 0);
            $bannedUsers = (int)(DB::one("SELECT COUNT(*) AS c FROM users WHERE is_banned = 1")['c'] ?? 0);
            $suspendedUsers = (int)(DB::one("SELECT COUNT(*) AS c FROM users WHERE suspended_until IS NOT NULL AND suspended_until > ?", [$nowIso])['c'] ?? 0);

            $totalListings = (int)(DB::one("SELECT COUNT(*) AS c FROM listings")['c'] ?? 0);
            $activeListings = (int)(DB::one("SELECT COUNT(*) AS c FROM listings WHERE status IN ('Approved','Active')")['c'] ?? 0);
            $pendingListings = (int)(DB::one("SELECT COUNT(*) AS c FROM listings WHERE status = 'Pending Approval'")['c'] ?? 0);
            $rejectedListings = (int)(DB::one("SELECT COUNT(*) AS c FROM listings WHERE status = 'Rejected'")['c'] ?? 0);

            // Reports (handle schema without status)
            $hasStatus = false;
            try {
                $cols = DB::all("PRAGMA table_info(reports)");
                foreach ($cols as $c) { if (strtolower((string)$c['name']) === 'status') { $hasStatus = true; break; } }
            } catch (\Throwable $e) {}
            if ($hasStatus) {
                $reportPending = (int)(DB::one("SELECT COUNT(*) AS c FROM reports WHERE status = 'pending'")['c'] ?? 0);
                $reportResolved = (int)(DB::one("SELECT COUNT(*) AS c FROM reports WHERE status = 'resolved'")['c'] ?? 0);
            } else {
                $allReports = (int)(DB::one("SELECT COUNT(*) AS c FROM reports")['c'] ?? 0);
                $reportPending = $allReports;
                $reportResolved = 0;
            }

            // Visitors
            $visitorsTotal = 0;
            $visitorsInRange = 0;
            try {
                $visitorsTotal = (int)(DB::one("SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ip IS NOT NULL AND TRIM(ip) <> ''")['c'] ?? 0);
                $visitorsInRange = (int)(DB::one("SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ts >= ? AND ip IS NOT NULL AND TRIM(ip) <> ''", [$rangeStartIso])['c'] ?? 0);
            } catch (\Throwable $e) {}

            // Filesystem stats
            $base = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
            $dataDir = $base . '/data';
            $uploadsDir = $dataDir . '/uploads';

            $safeStat = function (string $p) {
                try { return @stat($p); } catch (\Throwable $e) { return null; }
            };
            $countFilesRec = function (string $dir, array $opts = []) use (&$countFilesRec, $safeStat) {
                $st = $safeStat($dir);
                if (!$st || !is_dir($dir)) return 0;
                $count = 0;
                $skip = isset($opts['skip']) && is_array($opts['skip']) ? array_flip($opts['skip']) : [];
                $filterExt = isset($opts['filterExt']) && is_array($opts['filterExt']) ? array_flip(array_map('strtolower', $opts['filterExt'])) : null;
                $dh = @opendir($dir);
                if (!$dh) return 0;
                while (($entry = readdir($dh)) !== false) {
                    if ($entry === '.' || $entry === '..') continue;
                    if (isset($skip[$entry])) continue;
                    $p = $dir . '/' . $entry;
                    $s = $safeStat($p);
                    if (!$s) continue;
                    if (is_dir($p)) {
                        $count += $countFilesRec($p, $opts);
                    } elseif (is_file($p)) {
                        if ($filterExt) {
                            $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                            if (!isset($filterExt[$ext])) continue;
                        }
                        $count++;
                    }
                }
                @closedir($dh);
                return $count;
            };
            $listFilesRec = function (string $dir, array $opts = []) use (&$listFilesRec, $safeStat) {
                $out = [];
                $st = $safeStat($dir);
                if (!$st || !is_dir($dir)) return $out;
                $skip = isset($opts['skip']) && is_array($opts['skip']) ? array_flip($opts['skip']) : [];
                $filterExt = isset($opts['filterExt']) && is_array($opts['filterExt']) ? array_flip(array_map('strtolower', $opts['filterExt'])) : null;
                $dh = @opendir($dir);
                if (!$dh) return $out;
                while (($entry = readdir($dh)) !== false) {
                    if ($entry === '.' || $entry === '..') continue;
                    if (isset($skip[$entry])) continue;
                    $p = $dir . '/' . $entry;
                    $s = $safeStat($p);
                    if (!$s) continue;
                    if (is_dir($p)) {
                        $out = array_merge($out, $listFilesRec($p, $opts));
                    } elseif (is_file($p)) {
                        if ($filterExt) {
                            $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                            if (!isset($filterExt[$ext])) continue;
                        }
                        $out[] = ['path' => $p, 'size' => $s['size'] ?? 0, 'mtime' => isset($s['mtime']) ? (int)$s['mtime'] : null];
                    }
                }
                @closedir($dh);
                return $out;
            };

            $imageEntries = [];
            $imagesCount = 0;
            $uploadsDiskUsageBytes = 0;
            try {
                $exts = ['webp','jpg','jpeg','png','gif','avif','tiff'];
                $imageEntries = $listFilesRec($uploadsDir, ['filterExt' => $exts]);
                $imagesCount = count($imageEntries);
                if ($imagesCount === 0) {
                    $imageEntries = $listFilesRec($uploadsDir, []);
                    $imagesCount = count($imageEntries);
                }
                foreach ($imageEntries as $ent) { $uploadsDiskUsageBytes += (int)($ent['size'] ?? 0); }
            } catch (\Throwable $e) {}

            $databasesCount = 0;
            try {
                $dbExts = ['sqlite','db'];
                $databasesCount = $countFilesRec($dataDir, ['filterExt' => $dbExts]);
            } catch (\Throwable $e) {}

            $systemFilesCount = 0;
            try {
                $systemFilesCount = $countFilesRec($dataDir, ['skip' => ['uploads']]);
            } catch (\Throwable $e) {}

            $allFilesCount = 0;
            try {
                $root = $base;
                $allFilesCount = $countFilesRec($root, ['skip' => ['node_modules','.git']]);
            } catch (\Throwable $e) {}

            // Range-limited totals
            $usersNewInRange = (int)(DB::one("SELECT COUNT(*) AS c FROM users WHERE created_at >= ?", [$rangeStartIso])['c'] ?? 0);
            $listingsNewInRange = (int)(DB::one("SELECT COUNT(*) AS c FROM listings WHERE created_at >= ?", [$rangeStartIso])['c'] ?? 0);
            $approvalsInRange = 0;
            $rejectionsInRange = 0;
            try {
                $approvalsInRange = (int)(DB::one("SELECT COUNT(*) AS c FROM admin_actions WHERE action='approve' AND ts >= ?", [$rangeStartIso])['c'] ?? 0);
                $rejectionsInRange = (int)(DB::one("SELECT COUNT(*) AS c FROM admin_actions WHERE action='reject' AND ts >= ?", [$rangeStartIso])['c'] ?? 0);
            } catch (\Throwable $e) {}
            $reportsInRange = 0;
            try {
                $reportsInRange = (int)(DB::one("SELECT COUNT(*) AS c FROM reports WHERE ts >= ?", [$rangeStartIso])['c'] ?? 0);
            } catch (\Throwable $e) {}

            // Time windows
            $win = [];
            for ($i = $daysParam - 1; $i >= 0; $i--) {
                $start = (clone $now)->setTime(0, 0, 0)->sub(new \DateInterval('P' . $i . 'D'));
                $end = (clone $start)->add(new \DateInterval('P1D'));
                $win[] = ['start' => $start, 'end' => $end];
            }

            $seriesSignups = [];
            $seriesListingsCreated = [];
            $seriesApprovals = [];
            $seriesRejections = [];
            $seriesReports = [];
            $seriesVisitorsPerDay = [];

            foreach ($win as $w) {
                $sIso = $w['start']->format('c');
                $eIso = $w['end']->format('c');
                $seriesSignups[] = [
                    'date' => $w['start']->format('Y-m-d'),
                    'count' => (int)(DB::one("SELECT COUNT(*) AS c FROM users WHERE created_at >= ? AND created_at < ?", [$sIso, $eIso])['c'] ?? 0)
                ];
                $seriesListingsCreated[] = [
                    'date' => $w['start']->format('Y-m-d'),
                    'count' => (int)(DB::one("SELECT COUNT(*) AS c FROM listings WHERE created_at >= ? AND created_at < ?", [$sIso, $eIso])['c'] ?? 0)
                ];
                $seriesApprovals[] = [
                    'date' => $w['start']->format('Y-m-d'),
                    'count' => (int)(DB::one("SELECT COUNT(*) AS c FROM admin_actions WHERE action = 'approve' AND ts >= ? AND ts < ?", [$sIso, $eIso])['c'] ?? 0)
                ];
                $seriesRejections[] = [
                    'date' => $w['start']->format('Y-m-d'),
                    'count' => (int)(DB::one("SELECT COUNT(*) AS c FROM admin_actions WHERE action = 'reject' AND ts >= ? AND ts < ?", [$sIso, $eIso])['c'] ?? 0)
                ];
                $cVisitors = 0;
                try {
                    $cVisitors = (int)(DB::one("SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ts >= ? AND ts < ? AND ip IS NOT NULL AND TRIM(ip) <> ''", [$sIso, $eIso])['c'] ?? 0);
                } catch (\Throwable $e) {}
                $seriesVisitorsPerDay[] = ['date' => $w['start']->format('Y-m-d'), 'count' => $cVisitors];
                $cReports = 0;
                try {
                    $cReports = (int)(DB::one("SELECT COUNT(*) AS c FROM reports WHERE ts >= ? AND ts < ?", [$sIso, $eIso])['c'] ?? 0);
                } catch (\Throwable $e) {}
                $seriesReports[] = ['date' => $w['start']->format('Y-m-d'), 'count' => $cReports];
            }

            // Images added per day (based on mtime)
            $imagesAddedPerDay = [];
            $buckets = [];
            foreach ($imageEntries as $ent) {
                if (!isset($ent['mtime'])) continue;
                $d = gmdate('Y-m-d', (int)$ent['mtime']);
                $buckets[$d] = ($buckets[$d] ?? 0) + 1;
            }
            foreach ($win as $w) {
                $key = $w['start']->format('Y-m-d');
                $imagesAddedPerDay[] = ['date' => $key, 'count' => (int)($buckets[$key] ?? 0)];
            }

            // Top categories among approved/active listings
            $topCategories = DB::all("
              SELECT main_category as category, COUNT(*) as cnt
              FROM listings
              WHERE status IN ('Approved','Active') AND main_category IS NOT NULL AND main_category <> ''
              GROUP BY main_category
              ORDER BY cnt DESC
              LIMIT 8
            ");
            foreach ($topCategories as &$tc) { $tc['cnt'] = (int)$tc['cnt']; }

            $statusBreakdown = [
                ['status' => 'Active/Approved', 'count' => $activeListings],
                ['status' => 'Pending Approval', 'count' => $pendingListings],
                ['status' => 'Rejected', 'count' => $rejectedListings],
            ];

            \json_response([
                'params' => ['days' => $daysParam, 'rangeStart' => $rangeStartIso],
                'totals' => [
                    'totalUsers' => $totalUsers,
                    'bannedUsers' => $bannedUsers,
                    'suspendedUsers' => $suspendedUsers,
                    'totalListings' => $totalListings,
                    'activeListings' => $activeListings,
                    'pendingListings' => $pendingListings,
                    'rejectedListings' => $rejectedListings,
                    'reportPending' => $reportPending,
                    'reportResolved' => $reportResolved,
                    'visitorsTotal' => $visitorsTotal,
                    'imagesCount' => $imagesCount,
                    'systemFilesCount' => $systemFilesCount,
                    'databasesCount' => $databasesCount,
                    'uploadsDiskUsageBytes' => $uploadsDiskUsageBytes,
                    'allFilesCount' => $allFilesCount
                ],
                'rangeTotals' => [
                    'usersNewInRange' => $usersNewInRange,
                    'listingsNewInRange' => $listingsNewInRange,
                    'approvalsInRange' => $approvalsInRange,
                    'rejectionsInRange' => $rejectionsInRange,
                    'reportsInRange' => $reportsInRange,
                    'visitorsInRange' => $visitorsInRange
                ],
                'series' => [
                    'signups' => $seriesSignups,
                    'listingsCreated' => $seriesListingsCreated,
                    'approvals' => $seriesApprovals,
                    'rejections' => $seriesRejections,
                    'reports' => $seriesReports,
                    'visitorsPerDay' => $seriesVisitorsPerDay,
                    'imagesAddedPerDay' => $imagesAddedPerDay
                ],
                'topCategories' => $topCategories,
                'statusBreakdown' => $statusBreakdown
            ]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load metrics'], 500);
        }
    }

    public static function usersList(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $q = strtolower(trim((string)($_GET['q'] ?? '')));
        $limit = max(1, min(500, (int)($_GET['limit'] ?? 100)));
        $sql = "SELECT id, email, username, is_admin, is_banned, suspended_until, is_verified, created_at FROM users";
        $params = [];
        if ($q) { $sql .= " WHERE LOWER(email) LIKE ? OR LOWER(username) LIKE ?"; $term = '%' . $q . '%'; $params = [$term, $term]; }
        $sql .= " ORDER BY id DESC LIMIT ?";
        $params[] = $limit;
        $rows = DB::all($sql, $params);
        \json_response(['results' => $rows]);
    }

    public static function userVerify(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE users SET is_verified = 1 WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function userUnverify(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE users SET is_verified = 0 WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function userBan(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE users SET is_banned = 1 WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function userUnban(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE users SET is_banned = 0 WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function userSuspend7(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $until = gmdate('c', time() + 7 * 24 * 3600);
        DB::exec("UPDATE users SET suspended_until = ? WHERE id = ?", [$until, $id]);
        \json_response(['ok' => true]);
    }

    public static function userSuspend(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $days = max(1, (int)($b['days'] ?? 7));
        $until = gmdate('c', time() + $days * 24 * 3600);
        DB::exec("UPDATE users SET suspended_until = ? WHERE id = ?", [$until, $id]);
        \json_response(['ok' => true]);
    }

    public static function userUnsuspend(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE users SET suspended_until = NULL WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function backup(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $baseDir = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        $uploadsDir = $baseDir . '/data/uploads';
        $dbPath = getenv('DB_PATH') ?: ($baseDir . '/data/ganudenu.sqlite');

        $zip = new \ZipArchive();
        $tmpZip = sys_get_temp_dir() . '/ganudenu_backup_' . date('Ymd_His') . '.zip';
        if ($zip->open($tmpZip, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            \json_response(['error' => 'Failed to create ZIP'], 500); return;
        }
        if (is_dir($uploadsDir)) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($uploadsDir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST);
            foreach ($files as $file) {
                $path = $file->getRealPath();
                $rel = substr($path, strlen($uploadsDir) + 1);
                if ($file->isDir()) continue;
                $zip->addFile($path, 'uploads/' . $rel);
            }
        }
        if (is_file($dbPath)) {
            $zip->addFile($dbPath, 'ganudenu.sqlite');
        }
        $zip->close();

        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="ganudenu_backup.zip"');
        header('Content-Length: ' . filesize($tmpZip));
        readfile($tmpZip);
        @unlink($tmpZip);
    }

    public static function restore(): void
    {
        $admin = self::requireAdmin2FA(); if (!$admin) return;
        if (empty($_FILES['backup']) || !is_uploaded_file($_FILES['backup']['tmp_name'])) {
            \json_response(['error' => 'backup file required'], 400); return;
        }
        $tmp = $_FILES['backup']['tmp_name'];
        $zip = new \ZipArchive();
        if ($zip->open($tmp) !== true) {
            \json_response(['error' => 'Invalid ZIP'], 400); return;
        }
        $baseDir = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        $uploadsDir = $baseDir . '/data/uploads';
        $dbPath = getenv('DB_PATH') ?: ($baseDir . '/data/ganudenu.sqlite');

        // Restore DB
        $dbIndex = $zip->locateName('ganudenu.sqlite', \ZipArchive::FL_NODIR | \ZipArchive::FL_NOCASE);
        if ($dbIndex !== false) {
            @mkdir(dirname($dbPath), 0775, true);
            copy("zip://{$tmp}#ganudenu.sqlite", $dbPath);
        }
        // Restore uploads
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $name = $st['name'];
            if (str_starts_with($name, 'uploads/')) {
                $rel = substr($name, strlen('uploads/'));
                $dest = $uploadsDir . '/' . $rel;
                @mkdir(dirname($dest), 0775, true);
                copy("zip://{$tmp}#{$name}", $dest);
            }
        }
        $zip->close();
        \json_response(['ok' => true]);
    }

    private static function filePathToUrl(?string $p): ?string
    {
        if (!$p) return null;
        $filename = basename((string)$p);
        return $filename ? '/uploads/' . $filename : null;
    }

    private static function ensureReportsSchema(): void
    {
        try {
            $cols = DB::all("PRAGMA table_info(reports)");
            $names = array_map(fn($c) => strtolower((string)$c['name']), $cols);
            if (!in_array('status', $names, true)) {
                DB::exec("ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
            }
            if (!in_array('handled_by', $names, true)) {
                DB::exec("ALTER TABLE reports ADD COLUMN handled_by INTEGER");
            }
            if (!in_array('handled_at', $names, true)) {
                DB::exec("ALTER TABLE reports ADD COLUMN handled_at TEXT");
            }
        } catch (\Throwable $e) {
            // ignore
        }
    }

    // Admin notifications management
    public static function notificationsList(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        try {
            $rows = DB::all("
              SELECT id, title, message, target_email, created_at
              FROM notifications
              ORDER BY id DESC
              LIMIT 200
            ");
            \json_response(['results' => $rows]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load notifications'], 500);
        }
    }

    public static function notificationsCreate(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $title = trim((string)($b['title'] ?? ''));
        $message = trim((string)($b['message'] ?? ''));
        $targetEmail = isset($b['targetEmail']) ? strtolower(trim((string)$b['targetEmail'])) : null;
        $sendEmailFlag = !empty($b['sendEmail']);

        if ($title === '' || $message === '') {
            \json_response(['error' => 'title and message are required'], 400);
            return;
        }

        if ($targetEmail && $sendEmailFlag) {
            try {
                $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                    . '<h2 style="margin:0 0 10px 0;">' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h2>'
                    . '<div>' . nl2br(htmlspecialchars($message, ENT_QUOTES, 'UTF-8')) . '</div>'
                    . '</div>';
                $sent = \App\Services\EmailService::send($targetEmail, $title, $html);
                if (empty($sent['ok'])) {
                    // continue with in-app notification regardless
                }
            } catch (\Throwable $e) {
                // continue with in-app notification
            }
        }

        try {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at)
              VALUES (?, ?, ?, ?)
            ", [$title, $message, $targetEmail ?: null, gmdate('c')]);
            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to create notification'], 500);
        }
    }

    public static function notificationsDelete(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        try {
            DB::exec("DELETE FROM notifications WHERE id = ?", [$id]);
            try { DB::exec("DELETE FROM notification_reads WHERE notification_id = ?", [$id]); } catch (\Throwable $e) {}
            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to delete notification'], 500);
        }
    }

    // Reports management
    public static function reportsList(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        self::ensureReportsSchema();
        $status = strtolower((string)($_GET['status'] ?? 'pending'));
        try {
            if ($status === 'pending' || $status === 'resolved') {
                $rows = DB::all("SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 500", [$status]);
            } else {
                $rows = DB::all("SELECT * FROM reports ORDER BY id DESC LIMIT 500");
            }
            \json_response(['results' => $rows]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load reports'], 500);
        }
    }

    public static function reportResolve(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        self::ensureReportsSchema();
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        try {
            DB::exec("UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?", [$admin['id'], gmdate('c'), $id]);
            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to resolve report'], 500);
        }
    }

    public static function reportDelete(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        try {
            DB::exec("DELETE FROM reports WHERE id = ?", [$id]);
            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to delete report'], 500);
        }
    }

    // Admin listing management
    public static function userListings(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $userId = (int)($params['id'] ?? 0);
        if (!$userId) { \json_response(['error' => 'Invalid user id'], 400); return; }
        try {
            $user = DB::one("SELECT email FROM users WHERE id = ?", [$userId]);
            if (!$user || empty($user['email'])) { \json_response(['error' => 'User not found'], 404); return; }
            $rows = DB::all("
              SELECT id, main_category, title, location, price, status, thumbnail_path, created_at, is_urgent
              FROM listings
              WHERE LOWER(owner_email) = LOWER(?)
              ORDER BY created_at DESC
              LIMIT 300
            ", [strtolower(trim((string)$user['email']))]);
            $results = [];
            foreach ($rows as $r) {
                $results[] = [
                    'id' => (int)$r['id'],
                    'main_category' => $r['main_category'],
                    'title' => $r['title'],
                    'location' => $r['location'],
                    'price' => $r['price'],
                    'status' => $r['status'],
                    'thumbnail_url' => self::filePathToUrl($r['thumbnail_path']),
                    'created_at' => $r['created_at'],
                    'urgent' => !!$r['is_urgent'],
                    'is_urgent' => !!$r['is_urgent']
                ];
            }
            \json_response(['results' => $results, 'user' => ['id' => $userId, 'email' => $user['email']]]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load user listings'], 500);
        }
    }

    public static function listingUrgent(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $urgent = !empty($b['urgent']);
        if (!$id) { \json_response(['error' => 'Invalid listing id'], 400); return; }
        try {
            DB::exec("UPDATE listings SET is_urgent = ? WHERE id = ?", [$urgent ? 1 : 0, $id]);
            DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
            DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, ?, ?)", [$admin['id'], $id, $urgent ? 'urgent_on' : 'urgent_off', gmdate('c')]);
            \json_response(['ok' => true, 'urgent' => $urgent]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to update urgent flag'], 500);
        }
    }

    public static function listingDelete(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid listing id'], 400); return; }
        try {
            $listing = DB::one("SELECT * FROM listings WHERE id = ?", [$id]);
            if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }

            // Delete associated images
            $images = DB::all("SELECT path, medium_path FROM listing_images WHERE listing_id = ?", [$id]);
            foreach ($images as $img) {
                if (!empty($img['path'])) @unlink($img['path']);
                if (!empty($img['medium_path'])) @unlink($img['medium_path']);
            }
            if (!empty($listing['thumbnail_path'])) @unlink($listing['thumbnail_path']);
            if (!empty($listing['medium_path'])) @unlink($listing['medium_path']);
            if (!empty($listing['og_image_path'])) @unlink($listing['og_image_path']);

            DB::exec("DELETE FROM listing_images WHERE listing_id = ?", [$id]);
            DB::exec("DELETE FROM reports WHERE listing_id = ?", [$id]);
            DB::exec("DELETE FROM notifications WHERE listing_id = ?", [$id]);
            DB::exec("DELETE FROM listings WHERE id = ?", [$id]);

            DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
            DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'delete_listing', ?)", [$admin['id'], $id, gmdate('c')]);

            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to delete listing'], 500);
        }
    }

    private static function isValidJson(string $s): bool
    {
        if ($s === '') return false;
        json_decode($s, true);
        return json_last_error() === JSON_ERROR_NONE;
    }
}