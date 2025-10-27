<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\FacebookPoster;
use App\Services\EmailService;
use App\Services\SecureConfig;

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

        // Minimal type validation
        $errors = [];
        $has = function (string $k) use ($b) { return array_key_exists($k, $b); };
        $validateStr = function (string $key, $val, int $minLen, int $maxLen, bool $allowEmpty) use (&$errors) {
            if ($val === null) return;
            if (!is_string($val)) { $errors[] = "{$key} must be a string"; return; }
            $len = strlen(trim((string)$val));
            if (!$allowEmpty && $len === 0) { $errors[] = "{$key} cannot be empty"; return; }
            if ($len < $minLen || $len > $maxLen) { $errors[] = "{$key} length must be between {$minLen} and {$maxLen}"; }
        };
        $validateBool = function (string $key, $val) use (&$errors) {
            if ($val === null) return;
            if (!is_bool($val)) { $errors[] = "{$key} must be a boolean"; }
        };
        $validateInt = function (string $key, $val, int $min, int $max) use (&$errors) {
            if ($val === null) return;
            if (!is_int($val)) { $errors[] = "{$key} must be an integer"; return; }
            if ($val < $min || $val > $max) { $errors[] = "{$key} must be between {$min} and {$max}"; }
        };

        $validateStr('bankDetails', $b['bankDetails'] ?? null, 0, 2000, true);
        $validateStr('whatsappNumber', $b['whatsappNumber'] ?? null, 0, 64, true);
        $validateBool('emailOnApprove', $b['emailOnApprove'] ?? null);
        $validateBool('maintenanceMode', $b['maintenanceMode'] ?? null);
        $validateStr('maintenanceMessage', $has('maintenanceMessage') ? ($b['maintenanceMessage'] ?? null) : null, 0, 1000, true);
        $validateStr('bankAccountNumber', $b['bankAccountNumber'] ?? null, 0, 64, true);
        $validateStr('bankAccountName', $b['bankAccountName'] ?? null, 0, 100, true);
        $validateStr('bankName', $b['bankName'] ?? null, 0, 100, true);

        if (!empty($b['paymentRules'])) {
            if (!is_array($b['paymentRules'])) {
                $errors[] = 'paymentRules must be an array';
            } else {
                foreach ($b['paymentRules'] as $i => $rule) {
                    if (!is_array($rule)) { $errors[] = "paymentRules[{$i}] must be an object"; continue; }
                    $cat = $rule['category'] ?? null;
                    if (!is_string($cat) || trim($cat) === '') { $errors[] = "paymentRules[{$i}].category must be a non-empty string"; }
                    elseif (strlen($cat) > 50) { $errors[] = "paymentRules[{$i}].category must be at most 50 characters"; }
                    $amt = $rule['amount'] ?? null;
                    if (!is_int($amt)) { $errors[] = "paymentRules[{$i}].amount must be an integer"; }
                    elseif ($amt < 0 || $amt > 1000000) { $errors[] = "paymentRules[{$i}].amount must be between 0 and 1000000"; }
                    $en = $rule['enabled'] ?? null;
                    if (!is_bool($en)) { $errors[] = "paymentRules[{$i}].enabled must be a boolean"; }
                }
            }
        }

        if (!empty($errors)) {
            \json_response(['error' => 'Invalid configuration payload', 'details' => $errors], 400);
            return;
        }

        $bankDetails = $has('bankDetails') ? (string)$b['bankDetails'] : null;
        $whatsappNumber = $has('whatsappNumber') ? (string)$b['whatsappNumber'] : null;
        $emailOnApprove = $has('emailOnApprove') ? ($b['emailOnApprove'] ? 1 : 0) : null;
        $maintenanceMode = $has('maintenanceMode') ? ($b['maintenanceMode'] ? 1 : 0) : null;
        $maintenanceMessage = $has('maintenanceMessage') ? (string)$b['maintenanceMessage'] : null;
        $bankAccountNumber = $has('bankAccountNumber') ? (string)$b['bankAccountNumber'] : null;
        $bankAccountName = $has('bankAccountName') ? (string)$b['bankAccountName'] : null;
        $bankName = $has('bankName') ? (string)$b['bankName'] : null;

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
                $cat = trim((string)$rule['category']);
                $amt = (int)$rule['amount'];
                $en = !empty($rule['enabled']) ? 1 : 0;
                $up->execute([$cat, $amt, $en]);
            }
        }

        \json_response(['ok' => true]);
    }

    // Secure-config (AES-256-GCM with scrypt-derived key) parity with Node
    public static function configSecureStatus(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $st = SecureConfig::status();
        \json_response($st);
    }

    public static function configSecureDecrypt(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $pass = (string)($b['passphrase'] ?? '');
        if ($pass === '') { \json_response(['error' => 'passphrase required'], 400); return; }
        $res = SecureConfig::decryptFromFile($pass);
        if (empty($res['ok'])) {
            $code = (int)($res['status'] ?? 400);
            \json_response(['error' => $res['error'] ?? 'Decryption failed'], $code);
            return;
        }
        \json_response($res);
    }

    public static function configSecureEncrypt(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $pass = (string)($b['passphrase'] ?? '');
        if ($pass === '') { \json_response(['error' => 'passphrase required'], 400); return; }
        if (!array_key_exists('config', $b)) { \json_response(['error' => 'config required'], 400); return; }
        $jsonString = is_string($b['config']) ? $b['config'] : json_encode($b['config'], JSON_PRETTY_PRINT);
        if (!is_string($jsonString)) { \json_response(['error' => 'Invalid config'], 400); return; }
        $res = SecureConfig::encryptAndSave($pass, $jsonString);
        if (empty($res['ok'])) { \json_response(['error' => $res['error'] ?? 'Failed to write secure config'], 500); return; }
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

    private static function listingMatchesSavedSearch(array $listing, array $search): bool
    {
        try {
            $catOk = $search['category'] ? (string)$listing['main_category'] === (string)$search['category'] : true;
            $locOk = $search['location'] ? (stripos((string)$listing['location'], (string)$search['location']) !== false) : true;
            $p = isset($listing['price']) ? (float)$listing['price'] : null;
            $pMinOk = isset($search['price_min']) ? ($p !== null && $p >= (float)$search['price_min']) : true;
            $pMaxOk = isset($search['price_max']) ? ($p !== null && $p <= (float)$search['price_max']) : true;

            $filters = json_decode((string)($search['filters_json'] ?? '{}'), true) ?: [];
            $filtersOk = true;
            if ($filters && count($filters)) {
                $sj = json_decode((string)($listing['structured_json'] ?? '{}'), true) ?: [];
                foreach ($filters as $k => $v) {
                    if (!$v) continue;
                    $key = $k === 'model' ? 'model_name' : $k;
                    $got = strtolower((string)($sj[$key] ?? ''));
                    if (is_array($v)) {
                        $wants = array_map(fn($x) => strtolower((string)$x), $v);
                        if ($key === 'model_name' || $key === 'sub_category') {
                            $ok = false;
                            foreach ($wants as $w) { if ($w && str_contains($got, $w)) { $ok = true; break; } }
                            if (!$ok) { $filtersOk = false; break; }
                        } else {
                            $ok = false;
                            foreach ($wants as $w) { if ($w && $got === $w) { $ok = true; break; } }
                            if (!$ok) { $filtersOk = false; break; }
                        }
                    } else {
                        $want = strtolower((string)$v);
                        if ($key === 'model_name' || $key === 'sub_category') {
                            if (!str_contains($got, $want)) { $filtersOk = false; break; }
                        } else {
                            if ($got !== $want) { $filtersOk = false; break; }
                        }
                    }
                }
            }
            return $catOk && $locOk && $pMinOk && $pMaxOk && $filtersOk;
        } catch (\Throwable $e) {
            return false;
        }
    }

    private static function listingMatchesWanted(array $listing, array $wanted): bool
    {
        try {
            $cat = trim((string)($wanted['category'] ?? ''));
            $catOk = $cat ? ((string)$listing['main_category'] === $cat) : true;

            $locs = json_decode((string)($wanted['locations_json'] ?? '[]'), true) ?: [];
            $fallbackLoc = trim((string)($wanted['location'] ?? ''));
            if ($fallbackLoc) $locs[] = $fallbackLoc;
            $listingLoc = strtolower((string)($listing['location'] ?? ''));
            $locOk = $locs ? array_reduce($locs, function ($acc, $l) use ($listingLoc) { return $acc || (stripos($listingLoc, strtolower((string)$l)) !== false); }, false) : true;

            $p = isset($listing['price']) ? (float)$listing['price'] : null;
            $priceNotMatter = !empty($wanted['price_not_matter']);
            $pMin = isset($wanted['price_min']) ? (float)$wanted['price_min'] : null;
            $pMax = isset($wanted['price_max']) ? (float)$wanted['price_max'] : null;
            $priceOk = $priceNotMatter ? true : ($p !== null ? (($pMin === null || $p >= $pMin) && ($pMax === null || $p <= $pMax)) : false);

            $modelsOk = true;
            $catLower = (string)$cat;
            if (in_array($catLower, ['Vehicle','Mobile','Electronic'], true)) {
                $models = json_decode((string)($wanted['models_json'] ?? '[]'), true) ?: [];
                if ($models) {
                    $sj = json_decode((string)($listing['structured_json'] ?? '{}'), true) ?: [];
                    $gotModel = strtolower((string)($sj['model_name'] ?? $sj['model'] ?? ''));
                    $modelsOk = array_reduce($models, function ($acc, $m) use ($gotModel) { return $acc || ($gotModel && stripos($gotModel, strtolower((string)$m)) !== false); }, false);
                }
            }

            $yearOk = true;
            if ($catLower === 'Vehicle') {
                $yearMin = isset($wanted['year_min']) ? (int)$wanted['year_min'] : null;
                $yearMax = isset($wanted['year_max']) ? (int)$wanted['year_max'] : null;
                $sj = json_decode((string)($listing['structured_json'] ?? '{}'), true) ?: [];
                $rawY = $sj['manufacture_year'] ?? $sj['year'] ?? $sj['model_year'] ?? null;
                $y = $rawY !== null ? (int)preg_replace('/[^0-9]/', '', (string)$rawY) : null;
                if ($yearMin !== null || $yearMax !== null) {
                    if ($y === null) $yearOk = false;
                    else $yearOk = (($yearMin === null || $y >= $yearMin) && ($yearMax === null || $y <= $yearMax));
                }
            }

            $filtersOk = true;
            $filters = json_decode((string)($wanted['filters_json'] ?? '{}'), true) ?: [];
            if ($filters && count($filters)) {
                $sj = json_decode((string)($listing['structured_json'] ?? '{}'), true) ?: [];
                foreach ($filters as $k => $v) {
                    if (!$v) continue;
                    $key = $k === 'model' ? 'model_name' : $k;
                    $got = strtolower((string)($sj[$key] ?? ''));
                    if (is_array($v)) {
                        $wants = array_map(fn($x) => strtolower((string)$x), $v);
                        if ($key === 'model_name' || $key === 'sub_category') {
                            $ok = false;
                            foreach ($wants as $w) { if ($w && str_contains($got, $w)) { $ok = true; break; } }
                            if (!$ok) { $filtersOk = false; break; }
                        } else {
                            $ok = false;
                            foreach ($wants as $w) { if ($w && $got === $w) { $ok = true; break; } }
                            if (!$ok) { $filtersOk = false; break; }
                        }
                    } else {
                        $want = strtolower((string)$v);
                        if ($key === 'model_name' || $key === 'sub_category') {
                            if (!str_contains($got, $want)) { $filtersOk = false; break; }
                        } else {
                            if ($got !== $want) { $filtersOk = false; break; }
                        }
                    }
                }
            }

            return $catOk && $locOk && $priceOk && $modelsOk && $yearOk && $filtersOk;
        } catch (\Throwable $e) {
            return false;
        }
    }

    public static function pendingApprove(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        DB::exec("UPDATE listings SET status = 'Approved', reject_reason = NULL WHERE id = ?", [$id]);
        DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
        DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'approve', ?)", [$admin['id'], $id, gmdate('c')]);

        $listing = DB::one("SELECT id, title, owner_email, main_category, location, price, structured_json, phone FROM listings WHERE id = ?", [$id]);
        if (!empty($listing['owner_email'])) {
            DB::exec("DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'", [$id]);
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
              VALUES (?, ?, ?, ?, 'approved', ?)
            ", ['Listing Approved', 'Good news! Your ad "' . $listing['title'] . "\" (#{$id}) has been approved and is now live.", strtolower(trim((string)$listing['owner_email'])), gmdate('c'), $id]);
        }

        // Facebook poster (best-effort)
        $fb = FacebookPoster::postApproval($listing, $admin['email']);
        $fbUrl = null;
        if (!empty($fb['url'])) {
            $fbUrl = (string)$fb['url'];
            DB::exec("UPDATE listings SET facebook_post_url = ? WHERE id = ?", [$fbUrl, $id]);
        }

        // Saved searches notifications
        try {
            $searches = DB::all("SELECT * FROM saved_searches");
            foreach ($searches as $s) {
                if (self::listingMatchesSavedSearch($listing, $s)) {
                    DB::exec("
                      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                      VALUES (?, ?, ?, ?, 'saved_search', ?, ?)
                    ", ['New listing matches your search', 'A new "' . ($listing['title'] ?? '') . '" matches your saved search.', strtolower(trim((string)$s['user_email'])), gmdate('c'), $listing['id'], json_encode(['saved_search_id' => (int)$s['id']])]);
                }
            }
        } catch (\Throwable $e) {}

        // Wanted reverse notifications (buyers and seller)
        try {
            $wantedRows = DB::all("SELECT * FROM wanted_requests WHERE status = 'open'");
            foreach ($wantedRows as $w) {
                if (self::listingMatchesWanted($listing, $w)) {
                    DB::exec("
                      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                      VALUES (?, ?, ?, ?, 'wanted_match_buyer', ?, ?)
                    ", ['New ad matches your Wanted request', 'Match: "' . $listing['title'] . '". View the ad for details.', strtolower(trim((string)$w['user_email'])), gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                    // Email buyer (best-effort)
                    try {
                        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
                        $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                            . '<h2 style="margin:0 0 10px 0;">New match for your Wanted request</h2>'
                            . '<p style="margin:0 0 10px 0;">Matched ad: <strong>' . htmlspecialchars((string)$listing['title'], ENT_QUOTES, 'UTF-8') . '</strong></p>'
                            . '<p style="margin:10px 0 0 0;"><a href="' . $domain . '/listing/' . (int)$listing['id'] . '" style="color:#0b5fff;text-decoration:none;">View ad</a></p>'
                            . '</div>';
                        EmailService::send(strtolower(trim((string)$w['user_email'])), 'New match for your Wanted request', $html);
                    } catch (\Throwable $e) {}
                    $owner = strtolower(trim((string)$listing['owner_email'] ?? ''));
                    if ($owner) {
                        DB::exec("
                          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                          VALUES (?, ?, ?, ?, 'wanted_match_seller', ?, ?)
                        ", ['Immediate buyer request for your item', 'A buyer posted: "' . ($w['title'] ?? '') . '". Your ad may match.', $owner, gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                        // Email seller (best-effort)
                        try {
                            $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
                            $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                                . '<h2 style="margin:0 0 10px 0;">Immediate buyer request</h2>'
                                . '<p style="margin:0 0 10px 0;">A buyer posted: "<strong>' . htmlspecialchars((string)$w['title'], ENT_QUOTES, 'UTF-8') . '</strong>". Your ad "<strong>' . htmlspecialchars((string)$listing['title'], ENT_QUOTES, 'UTF-8') . '</strong>" may match.</p>'
                                . '<p style="margin:10px 0 0 0;"><a href="' . $domain . '/listing/' . (int)$listing['id'] . '" style="color:#0b5fff;text-decoration:none;">View your ad</a></p>'
                                . '</div>';
                            EmailService::send($owner, 'Immediate buyer request for your item', $html);
                        } catch (\Throwable $e) {}
                    }
                }
            }
        } catch (\Throwable $e) {}

        // Tagged wanted notifications (explicit tags)
        try {
            $tagRows = DB::all("SELECT wanted_id FROM listing_wanted_tags WHERE listing_id = ?", [$id]);
            if (!empty($tagRows)) {
                foreach ($tagRows as $row) {
                    $wid = (int)$row['wanted_id'];
                    if ($wid > 0) {
                        $wanted = DB::one("SELECT id, user_email, title FROM wanted_requests WHERE id = ?", [$wid]);
                        if ($wanted && !empty($wanted['user_email'])) {
                            DB::exec("
                              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                              VALUES (?, ?, ?, ?, 'wanted_tag_buyer', ?, ?)
                            ", ['A new ad was posted for your request', 'Tagged by seller: "' . ($listing['title'] ?? '') . '".', strtolower(trim((string)$wanted['user_email'])), gmdate('c'), $id, json_encode(['wanted_id' => (int)$wanted['id']])]);
                            // Email buyer (best-effort)
                            try {
                                $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
                                $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                                    . '<h2 style="margin:0 0 10px 0;">A new ad was posted for your request</h2>'
                                    . '<p style="margin:0 0 10px 0;">Seller tagged your request: <strong>' . htmlspecialchars((string)$wanted['title'], ENT_QUOTES, 'UTF-8') . '</strong></p>'
                                    . '<p style="margin:0 0 10px 0;">Ad: <strong>' . htmlspecialchars((string)$listing['title'], ENT_QUOTES, 'UTF-8') . '</strong></p>'
                                    . '<p style="margin:10px 0 0 0;"><a href="' . $domain . '/listing/' . (int)$listing['id'] . '" style="color:#0b5fff;text-decoration:none;">View ad</a></p>'
                                    . '</div>';
                                EmailService::send(strtolower(trim((string)$wanted['user_email'])), 'A new ad was posted for your request', $html);
                            } catch (\Throwable $e) {}
                        }
                    }
                }
            }
        } catch (\Throwable $e) {}

        // Facebook post notification + optional email_on_approve
        try {
            if ($fbUrl && !empty($listing['owner_email'])) {
                $target = strtolower(trim((string)$listing['owner_email']));
                DB::exec("
                  INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                  VALUES (?, ?, ?, ?, 'facebook_post', ?, ?)
                ", ['Your ad was shared on Facebook', 'Your ad "' . ($listing['title'] ?? '') . '" has been shared on our Facebook page. View it here: ' . $fbUrl, $target, gmdate('c'), (int)$listing['id'], json_encode(['facebook_post_url' => $fbUrl])]);

                $cfg = DB::one("SELECT email_on_approve FROM admin_config WHERE id = 1");
                $emailOnApprove = !!($cfg && $cfg['email_on_approve']);
                if ($emailOnApprove) {
                    $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                        . '<h2 style="margin:0 0 10px 0;">Your ad was shared on Facebook</h2>'
                        . '<p style="margin:0 0 8px 0;">We have shared your approved ad "<strong>' . htmlspecialchars((string)$listing['title'], ENT_QUOTES, 'UTF-8') . '</strong>" on our Facebook page.</p>'
                        . '<p style="margin:0 0 12px 0;"><a href="' . htmlspecialchars($fbUrl, ENT_QUOTES, 'UTF-8') . '" style="color:#0b5fff;text-decoration:none;">View Facebook post</a></p>'
                        . '<p style="color:#666;font-size:12px;margin:0;">Listing ID: ' . (int)$listing['id'] . '</p>'
                        . '</div>';
                    try { EmailService::send($target, 'Your ad was shared on Facebook', $html); } catch (\Throwable $e) {}
                }
            }
        } catch (\Throwable $e) {}

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
            $listing = DB::one("SELECT id, title, owner_email, main_category, location, price, structured_json, phone FROM listings WHERE id = ?", [$id]);
            if (!empty($listing['owner_email'])) {
                $delPending->execute([$id]);
                $insApproved->execute(['Listing Approved', 'Good news! Your ad "' . $listing['title'] . "\" (#{$id}) has been approved and is now live.", strtolower(trim((string)$listing['owner_email'])), gmdate('c'), $id]);
            }
            // Facebook post
            $fb = FacebookPoster::postApproval($listing, $admin['email']);
            $fbUrl = !empty($fb['url']) ? (string)$fb['url'] : null;
            if ($fbUrl) {
                DB::exec("UPDATE listings SET facebook_post_url = ? WHERE id = ?", [$fbUrl, $id]);
                // Notify owner and optional email
                try {
                    $target = strtolower(trim((string)$listing['owner_email']));
                    DB::exec("
                      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                      VALUES (?, ?, ?, ?, 'facebook_post', ?, ?)
                    ", ['Your ad was shared on Facebook', 'Your ad "' . ($listing['title'] ?? '') . '" has been shared on our Facebook page. View it here: ' . $fbUrl, $target, gmdate('c'), (int)$listing['id'], json_encode(['facebook_post_url' => $fbUrl])]);
                    $cfg = DB::one("SELECT email_on_approve FROM admin_config WHERE id = 1");
                    if ($cfg && !empty($cfg['email_on_approve'])) {
                        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
                        $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                            . '<h2 style="margin:0 0 10px 0;">Your ad was shared on Facebook</h2>'
                            . '<p style="margin:0 0 8px 0;">We have shared your approved ad "<strong>' . htmlspecialchars((string)$listing['title'], ENT_QUOTES, 'UTF-8') . '</strong>" on our Facebook page.</p>'
                            . '<p style="margin:0 0 12px 0;"><a href="' . htmlspecialchars($fbUrl, ENT_QUOTES, 'UTF-8') . '" style="color:#0b5fff;text-decoration:none;">View Facebook post</a></p>'
                            . '<p style="color:#666;font-size:12px;margin:0;">Listing ID: ' . (int)$listing['id'] . '</p>'
                            . '</div>';
                        try { EmailService::send($target, 'Your ad was shared on Facebook', $html); } catch (\Throwable $e) {}
                    }
                } catch (\Throwable $e) {}
            }

            // Saved search notifications
            try {
                $searches = DB::all("SELECT * FROM saved_searches");
                foreach ($searches as $s) {
                    if (self::listingMatchesSavedSearch($listing, $s)) {
                        DB::exec("
                          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                          VALUES (?, ?, ?, ?, 'saved_search', ?, ?)
                        ", ['New listing matches your search', 'A new "' . ($listing['title'] ?? '') . '" matches your saved search.', strtolower(trim((string)$s['user_email'])), gmdate('c'), $listing['id'], json_encode(['saved_search_id' => (int)$s['id']])]);
                    }
                }
            } catch (\Throwable $e) {}

            // Wanted reverse notifications and tag-based
            try {
                $wantedRows = DB::all("SELECT * FROM wanted_requests WHERE status = 'open'");
                foreach ($wantedRows as $w) {
                    if (self::listingMatchesWanted($listing, $w)) {
                        DB::exec("
                          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                          VALUES (?, ?, ?, ?, 'wanted_match_buyer', ?, ?)
                        ", ['New ad matches your Wanted request', 'Match: "' . $listing['title'] . '". View the ad for details.', strtolower(trim((string)$w['user_email'])), gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                        $owner = strtolower(trim((string)$listing['owner_email'] ?? ''));
                        if ($owner) {
                            DB::exec("
                              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                              VALUES (?, ?, ?, ?, 'wanted_match_seller', ?, ?)
                            ", ['Immediate buyer request for your item', 'A buyer posted: "' . ($w['title'] ?? '') . '". Your ad may match.', $owner, gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                        }
                    }
                }
                $tagRows = DB::all("SELECT wanted_id FROM listing_wanted_tags WHERE listing_id = ?", [$id]);
                if (!empty($tagRows)) {
                    foreach ($tagRows as $row) {
                        $wid = (int)$row['wanted_id'];
                        if ($wid > 0) {
                            $wanted = DB::one("SELECT id, user_email, title FROM wanted_requests WHERE id = ?", [$wid]);
                            if ($wanted && !empty($wanted['user_email'])) {
                                DB::exec("
                                  INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                                  VALUES (?, ?, ?, ?, 'wanted_tag_buyer', ?, ?)
                                ", ['A new ad was posted for your request', 'Tagged by seller: "' . ($listing['title'] ?? '') . '".', strtolower(trim((string)$wanted['user_email'])), gmdate('c'), $id, json_encode(['wanted_id' => (int)$wanted['id']])]);
                            }
                        }
                    }
                }
            } catch (\Throwable $e) {}
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
        $sql = "SELECT id, email, username, user_uid, is_admin, is_banned, suspended_until, is_verified, created_at FROM users";
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
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        DB::exec("UPDATE users SET is_verified = 1 WHERE id = ?", [$id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'verify')
            ", ['Account verified', 'Your account has been verified by an administrator.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
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
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        DB::exec("UPDATE users SET is_banned = 1, suspended_until = NULL WHERE id = ?", [$id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'ban')
            ", ['Account banned', 'Your account has been banned by an administrator.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
        \json_response(['ok' => true]);
    }

    public static function userUnban(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        DB::exec("UPDATE users SET is_banned = 0, suspended_until = NULL WHERE id = ?", [$id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'unban')
            ", ['Account unbanned', 'Your account ban has been lifted by an administrator.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
        \json_response(['ok' => true]);
    }

    public static function userSuspend7(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        $until = gmdate('c', time() + 7 * 24 * 3600);
        DB::exec("UPDATE users SET is_banned = 0, suspended_until = ? WHERE id = ?", [$until, $id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'suspend')
            ", ['Account suspended', 'Your account has been suspended until ' . $until . '.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
        \json_response(['ok' => true]);
    }

    public static function userSuspend(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $b = \read_body_json();
        $days = max(1, (int)($b['days'] ?? 7));
        $until = gmdate('c', time() + $days * 24 * 3600);
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        DB::exec("UPDATE users SET is_banned = 0, suspended_until = ? WHERE id = ?", [$until, $id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'suspend')
            ", ['Account suspended', 'Your account has been suspended for ' . $days . ' days until ' . $until . '.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
        \json_response(['ok' => true]);
    }

    public static function userUnsuspend(array $params): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $id = (int)($params['id'] ?? 0);
        $u = DB::one("SELECT email FROM users WHERE id = ?", [$id]);
        DB::exec("UPDATE users SET suspended_until = NULL WHERE id = ?", [$id]);
        if ($u && !empty($u['email'])) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'unsuspend')
            ", ['Account unsuspended', 'Your account suspension has been lifted by an administrator.', strtolower(trim((string)$u['email'])), gmdate('c')]);
        }
        \json_response(['ok' => true]);
    }

    // Admin flag listing
    public static function flag(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $b = \read_body_json();
        $listingId = (int)($b['listing_id'] ?? 0);
        $reason = trim((string)($b['reason'] ?? ''));
        if (!$listingId || $reason === '') { \json_response(['error' => 'listing_id and reason required'], 400); return; }
        DB::exec("CREATE TABLE IF NOT EXISTS admin_actions (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT, ts TEXT NOT NULL)");
        DB::exec("INSERT INTO admin_actions (admin_id, listing_id, action, reason, ts) VALUES (?, ?, 'flag', ?, ?)", [$admin['id'], $listingId, $reason, gmdate('c')]);
        \json_response(['ok' => true]);
    }

    public static function backup(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;
        $baseDir = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        $dataDir = $baseDir . '/data';
        $uploadsDir = $dataDir . '/uploads';
        $tmpAiDir = $dataDir . '/tmp_ai';
        $dbPath = getenv('DB_PATH') ?: ($dataDir . '/ganudenu.sqlite');
        $secureConfigPath = $dataDir . '/secure-config.enc';

        // Create a consistent DB snapshot (prefer VACUUM INTO; fallback to checkpoint + copy)
        $snapshot = sys_get_temp_dir() . '/ganudenu_db_snapshot_' . date('Ymd_His') . '.sqlite';
        $snapshotOk = false;
        try {
            $pdo = \App\Services\DB::conn();
            // Flush WAL and try VACUUM INTO
            try { $pdo->exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (\Throwable $e) {}
            $pdo->exec("VACUUM INTO '" . str_replace("'", "''", $snapshot) . "'");
            $snapshotOk = is_file($snapshot);
        } catch (\Throwable $e) {
            $snapshotOk = false;
        }
        if (!$snapshotOk) {
            try {
                $pdo = \App\Services\DB::conn();
                try { $pdo->exec("PRAGMA wal_checkpoint(FULL)"); } catch (\Throwable $e) {}
                if (is_file($dbPath)) {
                    @copy($dbPath, $snapshot);
                    $snapshotOk = is_file($snapshot);
                }
            } catch (\Throwable $e) { $snapshotOk = false; }
        }

        $zip = new \ZipArchive();
        $tmpZip = sys_get_temp_dir() . '/ganudenu_backup_' . date('Ymd_His') . '.zip';
        if ($zip->open($tmpZip, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            \json_response(['error' => 'Failed to create ZIP'], 500); return;
        }

        // Include uploads
        if (is_dir($uploadsDir)) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($uploadsDir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST);
            foreach ($files as $file) {
                $path = $file->getRealPath();
                $rel = substr($path, strlen($uploadsDir) + 1);
                if ($file->isDir()) continue;
                $zip->addFile($path, 'uploads/' . $rel);
            }
        }

        // Include tmp_ai directory
        if (is_dir($tmpAiDir)) {
            $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($tmpAiDir, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::SELF_FIRST);
            foreach ($files as $file) {
                $path = $file->getRealPath();
                $rel = substr($path, strlen($tmpAiDir) + 1);
                if ($file->isDir()) continue;
                $zip->addFile($path, 'tmp_ai/' . $rel);
            }
        }

        // Include secure-config.enc
        if (is_file($secureConfigPath)) {
            $zip->addFile($secureConfigPath, 'secure-config.enc');
        }

        // Include DB snapshot
        if ($snapshotOk && is_file($snapshot)) {
            $zip->addFile($snapshot, 'ganudenu.sqlite');
        } elseif (is_file($dbPath)) {
            // Fallback to current DB file if snapshot failed
            $zip->addFile($dbPath, 'ganudenu.sqlite');
        }

        // Meta.json
        $meta = [
            'created_at' => gmdate('c'),
            'db_snapshot_size_bytes' => (is_file($snapshot) ? (int)filesize($snapshot) : (is_file($dbPath) ? (int)filesize($dbPath) : 0)),
            'sqlite_version' => null
        ];
        try {
            $row = \App\Services\DB::one("SELECT sqlite_version() AS v");
            if ($row && isset($row['v'])) $meta['sqlite_version'] = (string)$row['v'];
        } catch (\Throwable $e) {}
        $zip->addFromString('meta.json', json_encode($meta, JSON_PRETTY_PRINT));

        $zip->close();

        // Stream ZIP to client
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="ganudenu_backup.zip"');
        header('Content-Length: ' . filesize($tmpZip));
        readfile($tmpZip);
        @unlink($tmpZip);
        if (is_file($snapshot)) @unlink($snapshot);
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
        $dataDir = $baseDir . '/data';
        $uploadsDir = $dataDir . '/uploads';
        $tmpAiDir = $dataDir . '/tmp_ai';
        $dbPath = getenv('DB_PATH') ?: ($dataDir . '/ganudenu.sqlite');
        $secureConfigPath = $dataDir . '/secure-config.enc';

        // Helper: safe join + whitelist (zip-slip protection)
        $safeJoin = function (string $base, string $rel): ?string {
            $baseReal = realpath($base) ?: $base;
            $relNorm = str_replace('\\', '/', $rel);
            // Reject absolute paths and traversal
            if ($relNorm === '' || $relNorm[0] === '/' || str_contains($relNorm, '..')) return null;
            // Clean segments conservatively
            $parts = array_filter(explode('/', $relNorm), fn($seg) => $seg !== '' && $seg !== '.');
            $path = $baseReal;
            foreach ($parts as $seg) {
                // Allow common filename chars only
                if (!preg_match('/^[A-Za-z0-9._-]+$/', $seg)) return null;
                $path .= '/' . $seg;
            }
            // Final containment check
            $prefix = rtrim($baseReal, '/') . '/';
            $candidate = $path;
            if (str_starts_with($candidate, $prefix)) return $candidate;
            return null;
        };

        // Restore DB using attach/copy sequence
        $tempDb = sys_get_temp_dir() . '/ganudenu_restore_' . date('Ymd_His') . '.sqlite';
        $dbIndex = $zip->locateName('ganudenu.sqlite', \ZipArchive::FL_NODIR | \ZipArchive::FL_NOCASE);
        if ($dbIndex !== false) {
            @mkdir(dirname($tempDb), 0775, true);
            if (!@copy("zip://{$tmp}#ganudenu.sqlite", $tempDb)) {
                $zip->close();
                \json_response(['error' => 'Failed to extract DB snapshot'], 500);
                return;
            }
            try {
                $pdo = \App\Services\DB::conn();
                $pdo->exec("PRAGMA foreign_keys = OFF");
                $pdo->exec("BEGIN EXCLUSIVE");
                $pdo->exec("ATTACH DATABASE '" . str_replace("'", "''", $tempDb) . "' AS restore");

                // Recreate tables
                $tables = \App\Services\DB::all("SELECT name, sql FROM restore.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
                foreach ($tables as $t) {
                    $name = (string)$t['name'];
                    $sql = (string)$t['sql'];
                    if ($name === '' || $sql === '') continue;
                    $pdo->exec('DROP TABLE IF EXISTS "' . str_replace('"', '""', $name) . '"');
                    $pdo->exec($sql);
                    $pdo->exec('INSERT INTO "' . str_replace('"', '""', $name) . '" SELECT * FROM restore."' . str_replace('"', '""', $name) . '"');
                }

                // Recreate indexes, triggers, views
                $others = \App\Services\DB::all("SELECT type, name, sql FROM restore.sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL");
                foreach ($others as $o) {
                    $type = strtolower((string)$o['type']);
                    $name = (string)$o['name'];
                    $sql = (string)$o['sql'];
                    if ($sql === '') continue;
                    if ($type === 'index') {
                        $pdo->exec('DROP INDEX IF EXISTS "' . str_replace('"', '""', $name) . '"');
                        $pdo->exec($sql);
                    } elseif ($type === 'trigger') {
                        $pdo->exec('DROP TRIGGER IF EXISTS "' . str_replace('"', '""', $name) . '"');
                        $pdo->exec($sql);
                    } elseif ($type === 'view') {
                        $pdo->exec('DROP VIEW IF EXISTS "' . str_replace('"', '""', $name) . '"');
                        $pdo->exec($sql);
                    }
                }

                $pdo->exec("DETACH DATABASE restore");
                $pdo->exec("COMMIT");
                $pdo->exec("PRAGMA foreign_keys = ON");
            } catch (\Throwable $e) {
                try { \App\Services\DB::exec("ROLLBACK"); } catch (\Throwable $e2) {}
                @unlink($tempDb);
                $zip->close();
                \json_response(['error' => 'Restore DB failed'], 500);
                return;
            }
            @unlink($tempDb);
        }

        // Restore uploads (with zip-slip whitelist)
        @mkdir($uploadsDir, 0775, true);
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $name = $st['name'];
            if (str_starts_with($name, 'uploads/')) {
                $rel = substr($name, strlen('uploads/'));
                $dest = $safeJoin($uploadsDir, $rel);
                if ($dest === null) continue;
                @mkdir(dirname($dest), 0775, true);
                @copy("zip://{$tmp}#{$name}", $dest);
            }
        }

        // Restore tmp_ai (with zip-slip whitelist)
        @mkdir($tmpAiDir, 0775, true);
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $st = $zip->statIndex($i);
            $name = $st['name'];
            if (str_starts_with($name, 'tmp_ai/')) {
                $rel = substr($name, strlen('tmp_ai/'));
                $dest = $safeJoin($tmpAiDir, $rel);
                if ($dest === null) continue;
                @mkdir(dirname($dest), 0775, true);
                @copy("zip://{$tmp}#{$name}", $dest);
            }
        }

        // Restore secure-config.enc if present
        $scIndex = $zip->locateName('secure-config.enc', \ZipArchive::FL_NODIR | \ZipArchive::FL_NOCASE);
        if ($scIndex !== false) {
            @mkdir(dirname($secureConfigPath), 0775, true);
            @copy("zip://{$tmp}#secure-config.enc", $secureConfigPath);
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