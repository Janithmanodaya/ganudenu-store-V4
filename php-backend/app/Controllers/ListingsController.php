<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\GeminiService;

class ListingsController
{
    // In-memory micro-cache (process-local)
    private static array $cache = [];

    private static function cacheGet(string $key)
    {
        $now = (int) (microtime(true) * 1000);
        if (!isset(self::$cache[$key])) return null;
        $item = self::$cache[$key];
        if ($item['expires'] <= $now) {
            unset(self::$cache[$key]);
            return null;
        }
        return $item['value'];
    }

    private static function cacheSet(string $key, $value, int $ttlMs = 15000): void
    {
        $ttlMs = max(1000, (int)$ttlMs);
        self::$cache[$key] = ['value' => $value, 'expires' => (int)(microtime(true) * 1000) + $ttlMs];
    }

    private static function filePathToUrl(?string $p): ?string
    {
        if (!$p) return null;
        $filename = basename((string)$p);
        return $filename ? '/uploads/' . $filename : null;
    }

    private static function ensureSchema(): void
    {
        $pdo = DB::conn();
        $pdo->exec("
          CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            main_category TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            structured_json TEXT,
            seo_title TEXT,
            seo_description TEXT,
            seo_keywords TEXT,
            seo_json TEXT,
            location TEXT,
            price REAL,
            pricing_type TEXT,
            phone TEXT,
            owner_email TEXT,
            thumbnail_path TEXT,
            medium_path TEXT,
            og_image_path TEXT,
            facebook_post_url TEXT,
            valid_until TEXT,
            status TEXT NOT NULL DEFAULT 'Pending Approval',
            created_at TEXT NOT NULL,
            model_name TEXT,
            manufacture_year INTEGER,
            reject_reason TEXT,
            views INTEGER NOT NULL DEFAULT 0,
            is_urgent INTEGER NOT NULL DEFAULT 0,
            remark_number TEXT,
            employee_profile INTEGER NOT NULL DEFAULT 0
          )
        ");
        $cols = DB::all("PRAGMA table_info(listings)");
        $names = array_map(fn($c) => $c['name'], $cols);
        foreach (['reject_reason','model_name','manufacture_year','remark_number','views','og_image_path','facebook_post_url','is_urgent','employee_profile'] as $c) {
            if (!in_array($c, $names)) {
                // protected: handled by CREATE above
            }
        }
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_images (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, path TEXT NOT NULL, original_name TEXT NOT NULL, medium_path TEXT)");
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, main_category TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, structured_json TEXT, seo_title TEXT, seo_description TEXT, seo_keywords TEXT, seo_json TEXT, resume_file_url TEXT, owner_email TEXT, created_at TEXT NOT NULL, enhanced_description TEXT, wanted_tags_json TEXT, employee_profile INTEGER DEFAULT 0)");
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_draft_images (id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id INTEGER NOT NULL, path TEXT NOT NULL, original_name TEXT NOT NULL)");
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_views (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, ip TEXT, viewer_email TEXT, ts TEXT NOT NULL, UNIQUE(listing_id, ip))");
        // Link table for listing <-> wanted tags (from draft.wanted_tags_json)
        $pdo->exec("CREATE TABLE IF NOT EXISTS listing_wanted_tags (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, wanted_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(listing_id, wanted_id))");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(main_category)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at)");
        $pdo->exec("CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_email)");
    }

    public static function list(): void
    {
        self::ensureSchema();
        try {
            // Micro-cache 15s per-URL
            $cacheKey = 'list:' . (string)($_SERVER['REQUEST_URI'] ?? '');
            $cached = self::cacheGet($cacheKey);
            if ($cached !== null) {
                header('Cache-Control: public, max-age=15');
                \json_response($cached);
                return;
            }

            $category = $_GET['category'] ?? null;
            $sortBy = $_GET['sortBy'] ?? null;
            $order = strtoupper($_GET['order'] ?? 'DESC');
            $status = $_GET['status'] ?? null;

            $query = "SELECT id, main_category, title, description, seo_description, structured_json, price, pricing_type, location, thumbnail_path, status, valid_until, created_at, og_image_path, facebook_post_url, is_urgent FROM listings WHERE status != 'Archived'";
            $params = [];
            if ($status) { $query .= " AND status = ?"; $params[] = $status; } else { $query .= " AND status = 'Approved'"; }
            if ($category) { $query .= " AND main_category = ?"; $params[] = $category; }

            $validSorts = ['created_at', 'price'];
            $validOrders = ['ASC', 'DESC'];
            if ($sortBy && in_array($sortBy, $validSorts, true) && in_array($order, $validOrders, true)) {
                $query .= " ORDER BY {$sortBy} {$order}";
            } else {
                $query .= " ORDER BY created_at DESC";
            }
            $query .= " LIMIT 100";
            $rows = DB::all($query, $params);

            $firstStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 1");
            $listStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 5");
            $results = [];
            foreach ($rows as $r) {
                $firstStmt->execute([(int)$r['id']]);
                $first = $firstStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
                $listStmt->execute([(int)$r['id']]);
                $imgs = $listStmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
                $thumbnail_url = self::filePathToUrl($r['thumbnail_path']) ?: self::filePathToUrl($first['medium_path'] ?? ($first['path'] ?? null));
                $small_images = array_values(array_filter(array_map(function ($x) { return self::filePathToUrl($x['medium_path'] ?? $x['path']); }, $imgs)));
                $og_image_url = self::filePathToUrl($r['og_image_path']);
                $r['thumbnail_url'] = $thumbnail_url;
                $r['small_images'] = $small_images;
                $r['og_image_url'] = $og_image_url;
                $r['urgent'] = !!$r['is_urgent'];
                $results[] = $r;
            }
            $payload = ['results' => $results];
            self::cacheSet($cacheKey, $payload, 15000);
            header('Cache-Control: public, max-age=15');
            \json_response($payload);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to fetch listings'], 500);
        }
    }

    public static function search(): void
    {
        self::ensureSchema();
        try {
            // Micro-cache 15s per-URL
            $cacheKey = 'search:' . (string)($_SERVER['REQUEST_URI'] ?? '');
            $cached = self::cacheGet($cacheKey);
            if ($cached !== null) {
                header('Cache-Control: public, max-age=15');
                \json_response($cached);
                return;
            }

            $q = strtolower(trim((string)($_GET['q'] ?? '')));
            $keyword_mode = strtolower(trim((string)($_GET['keyword_mode'] ?? 'or')));
            $category = (string)($_GET['category'] ?? '');
            $location = (string)($_GET['location'] ?? '');
            $price_min = (string)($_GET['price_min'] ?? '');
            $price_max = (string)($_GET['price_max'] ?? '');
            $filters = (string)($_GET['filters'] ?? '');
            $sort = strtolower((string)($_GET['sort'] ?? 'latest'));
            $page = max(1, (int)($_GET['page'] ?? 1));
            $limit = max(1, min(100, (int)($_GET['limit'] ?? 12)));
            $offset = ($page - 1) * $limit;

            $query = "
              SELECT id, main_category, title, description, seo_description, structured_json, price, pricing_type, location, thumbnail_path, status, valid_until, created_at, is_urgent, views
              FROM listings
              WHERE status = 'Approved'
            ";
            $params = [];
            if ($category) { $query .= " AND main_category = ?"; $params[] = $category; }
            if ($location) { $query .= " AND LOWER(location) LIKE ?"; $params[] = '%' . strtolower($location) . '%'; }
            if ($price_min !== '') { $query .= " AND price IS NOT NULL AND price >= ?"; $params[] = (float)$price_min; }
            if ($price_max !== '') { $query .= " AND price IS NOT NULL AND price <= ?"; $params[] = (float)$price_max; }

            if ($q) {
                $mode = $keyword_mode === 'and' ? 'and' : 'or';
                $terms = array_filter(explode(' ', $q));
                if ($mode === 'and' && count($terms) > 1) {
                    foreach ($terms as $t) {
                        $termLike = '%' . $t . '%';
                        $query .= " AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ?)";
                        array_push($params, $termLike, $termLike, $termLike);
                    }
                } else {
                    $term = '%' . $q . '%';
                    $query .= " AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(location) LIKE ?)";
                    array_push($params, $term, $term, $term);
                }
            }

            if ($sort === 'price_asc') $query .= " ORDER BY price ASC, created_at DESC";
            elseif ($sort === 'price_desc') $query .= " ORDER BY price DESC, created_at DESC";
            elseif ($sort === 'views_desc') $query .= " ORDER BY views DESC, created_at DESC";
            elseif ($sort === 'random') $query .= " ORDER BY RANDOM()";
            else $query .= " ORDER BY created_at DESC";

            $query .= " LIMIT ? OFFSET ?";
            array_push($params, $limit, $offset);

            $rows = DB::all($query, $params);

            $firstStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 1");
            $listStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 5");
            $results = [];
            foreach ($rows as $r) {
                $firstStmt->execute([(int)$r['id']]);
                $first = $firstStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
                $listStmt->execute([(int)$r['id']]);
                $imgs = $listStmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
                $thumbnail_url = self::filePathToUrl($r['thumbnail_path']) ?: self::filePathToUrl($first['medium_path'] ?? ($first['path'] ?? null));
                $small_images = array_values(array_filter(array_map(function ($x) { return self::filePathToUrl($x['medium_path'] ?? $x['path']); }, $imgs)));
                $r['thumbnail_url'] = $thumbnail_url;
                $r['small_images'] = $small_images;
                $results[] = $r;
            }
            $payload = ['results' => $results, 'page' => $page, 'limit' => $limit];
            self::cacheSet($cacheKey, $payload, 15000);
            header('Cache-Control: public, max-age=15');
            \json_response($payload);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to search listings'], 500);
        }
    }

    public static function suggestions(): void
    {
        self::ensureSchema();
        try {
            // Micro-cache 30s per-URL
            $cacheKey = 'suggestions:' . (string)($_SERVER['REQUEST_URI'] ?? '');
            $cached = self::cacheGet($cacheKey);
            if ($cached !== null) {
                header('Cache-Control: public, max-age=30');
                \json_response($cached);
                return;
            }

            $q = strtolower(trim((string)($_GET['q'] ?? '')));
            if (!$q) { \json_response(['results' => []]); return; }
            $category = trim((string)($_GET['category'] ?? ''));
            $exclude = trim((string)($_GET['exclude_category'] ?? ''));
            $sql = "SELECT title, location, structured_json, main_category FROM listings WHERE status = 'Approved'";
            $params = [];
            if ($category) { $sql .= " AND main_category = ?"; $params[] = $category; }
            elseif ($exclude) { $sql .= " AND main_category != ?"; $params[] = $exclude; }
            $sql .= " ORDER BY created_at DESC LIMIT 300";
            $rows = DB::all($sql, $params);
            $results = [];
            $seen = [];
            $push = function ($value, $type, $cat) use (&$results, &$seen) {
                $key = $type . '|' . strtolower($value);
                if (isset($seen[$key])) return;
                $seen[$key] = true;
                $results[] = ['value' => $value, 'type' => $type, 'category' => $cat ?: null];
            };
            foreach ($rows as $r) {
                $cat = (string)($r['main_category'] ?? '');
                if (!empty($r['title']) && stripos((string)$r['title'], $q) !== false) $push($r['title'], 'title', $cat);
                if (!empty($r['location']) && stripos((string)$r['location'], $q) !== false) $push($r['location'], 'location', $cat);
                $sj = json_decode((string)($r['structured_json'] ?? '{}'), true) ?: [];
                $sub = trim((string)($sj['sub_category'] ?? ''));
                $model = trim((string)($sj['model_name'] ?? ''));
                if ($sub && stripos($sub, $q) !== false) $push($sub, 'sub_category', $cat);
                if ($model && stripos($model, $q) !== false) $push($model, 'model', $cat);
                if (count($results) >= 50) break;
            }
            $payload = ['results' => $results];
            self::cacheSet($cacheKey, $payload, 30000);
            header('Cache-Control: public, max-age=30');
            \json_response($payload);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load suggestions'], 500);
        }
    }

    public static function get(array $params): void
    {
        self::ensureSchema();
        try {
            $id = (int)($params['id'] ?? 0);
            if (!$id) { \json_response(['error' => 'Invalid ID'], 400); return; }
            $listing = DB::one("SELECT * FROM listings WHERE id = ?", [$id]);
            if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }

            // View counting with IP and skipping owner
            try {
                $viewerEmail = '';
                $tok = JWT::getBearerToken();
                if ($tok) {
                    $v = JWT::verify($tok);
                    if ($v['ok'] && !empty($v['decoded']['email'])) $viewerEmail = strtolower(trim((string)$v['decoded']['email']));
                }
                $ownerEmail = strtolower(trim((string)($listing['owner_email'] ?? '')));
                $ip = client_ip();
                $shouldCount = true;
                if ($viewerEmail && $ownerEmail && $viewerEmail === $ownerEmail) $shouldCount = false;
                $cutoff = gmdate('c', time() - 24 * 3600);
                DB::exec("DELETE FROM listing_views WHERE ts < ?", [$cutoff]);
                if ($shouldCount && $ip) {
                    $exists = DB::one("SELECT 1 FROM listing_views WHERE listing_id = ? AND ip = ? LIMIT 1", [$id, $ip]);
                    if ($exists) $shouldCount = false;
                }
                if ($shouldCount) {
                    DB::exec("UPDATE listings SET views = COALESCE(views, 0) + 1 WHERE id = ?", [$id]);
                    $listing['views'] = (int)($listing['views'] ?? 0) + 1;
                    DB::exec("INSERT OR IGNORE INTO listing_views (listing_id, ip, viewer_email, ts) VALUES (?, ?, ?, ?)", [$id, $ip ?: null, $viewerEmail ?: null, gmdate('c')]);
                }
            } catch (\Throwable $e) {}

            $imagesRows = DB::all("SELECT id, path, original_name, medium_path FROM listing_images WHERE listing_id = ?", [$id]);
            $images = array_map(function ($img) {
                return [
                    'id' => (int)$img['id'],
                    'original_name' => $img['original_name'],
                    'path' => $img['path'],
                    'url' => self::filePathToUrl($img['path']),
                    'medium_url' => self::filePathToUrl($img['medium_path'])
                ];
            }, $imagesRows);
            $thumbnail_url = self::filePathToUrl($listing['thumbnail_path']);
            $medium_url = self::filePathToUrl($listing['medium_path']);
            $og_image_url = self::filePathToUrl($listing['og_image_path']);
            \json_response($listing + ['thumbnail_url' => $thumbnail_url, 'medium_url' => $medium_url, 'og_image_url' => $og_image_url, 'images' => $images]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to fetch listing'], 500);
        }
    }

    public static function report(array $params): void
    {
        try {
            $listingId = (int)($params['id'] ?? 0);
            $b = \read_body_json();
            $reason = (string)($b['reason'] ?? '');
            $reporter_email = (string)($b['reporter_email'] ?? '');
            if (!$listingId || !$reason) { \json_response(['error' => 'Invalid request'], 400); return; }
            DB::exec("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL, reporter_email TEXT, reason TEXT NOT NULL, ts TEXT NOT NULL)");
            DB::exec("INSERT INTO reports (listing_id, reason, reporter_email, ts) VALUES (?, ?, ?, ?)", [$listingId, $reason, $reporter_email ?: null, gmdate('c')]);
            \json_response(['ok' => true]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to submit report'], 500);
        }
    }

    public static function paymentInfo(array $params): void
    {
        try {
            // Micro-cache 60s per-ID
            $cacheKey = 'payment-info:' . (int)($params['id'] ?? 0);
            $cached = self::cacheGet($cacheKey);
            if ($cached !== null) {
                header('Cache-Control: public, max-age=60');
                \json_response($cached);
                return;
            }

            $id = (int)($params['id'] ?? 0);
            if (!$id) { \json_response(['error' => 'Invalid ID'], 400); return; }
            $listing = DB::one("SELECT id, title, price, owner_email, status, remark_number, main_category FROM listings WHERE id = ?", [$id]);
            if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }
            $cfg = DB::one("SELECT bank_details, whatsapp_number, bank_account_number, bank_account_name, bank_name FROM admin_config WHERE id = 1");

            $rule = DB::one("SELECT amount, enabled FROM payment_rules WHERE category = ?", [$listing['main_category'] ?? 'Other']);
            $defaults = ['Vehicle'=>300,'Property'=>500,'Job'=>200,'Electronic'=>200,'Mobile'=>0,'Home Garden'=>200,'Other'=>200];
            $payment_amount = (int)($rule['amount'] ?? ($defaults[$listing['main_category']] ?? $defaults['Other']));
            $payments_enabled = $rule ? !!$rule['enabled'] : true;

            $accNum = trim((string)($cfg['bank_account_number'] ?? ''));
            $accName = trim((string)($cfg['bank_account_name'] ?? ''));
            $bankName = trim((string)($cfg['bank_name'] ?? ''));
            $combined = trim((string)($cfg['bank_details'] ?? ''));
            if (!$combined && ($accNum || $accName || $bankName)) {
                $lines = [];
                if ($bankName) $lines[] = "Bank: {$bankName}";
                if ($accName) $lines[] = "Account Name: {$accName}";
                if ($accNum) $lines[] = "Account Number: {$accNum}";
                $combined = implode("\n", $lines);
            }

            $payload = [
                'ok' => true,
                'listing' => $listing,
                'bank_details' => $combined ?: '',
                'bank_account_number' => $accNum,
                'bank_account_name' => $accName,
                'bank_name' => $bankName,
                'whatsapp_number' => $cfg['whatsapp_number'] ?? '',
                'payment_amount' => $payment_amount,
                'payments_enabled' => $payments_enabled
            ];
            self::cacheSet($cacheKey, $payload, 60000);
            header('Cache-Control: public, max-age=60');
            \json_response($payload);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load payment info'], 500);
        }
    }

    public static function paymentNote(): void
    {
        $tok = JWT::getBearerToken();
        $v = $tok ? JWT::verify($tok) : ['ok' => false];
        if (!$v['ok']) { \json_response(['error' => 'Missing Authorization bearer token'], 401); return; }
        $claims = $v['decoded'];
        $sender = strtolower(trim((string)$claims['email']));
        $b = \read_body_json();
        $listingId = (int)($b['listing_id'] ?? 0);
        $noteText = trim((string)($b['note'] ?? ''));
        if (!$listingId) { \json_response(['error' => 'Invalid listing_id'], 400); return; }
        if (!$noteText || strlen($noteText) < 2) { \json_response(['error' => 'Note is required'], 400); return; }

        $listing = DB::one("SELECT id, title, owner_email FROM listings WHERE id = ?", [$listingId]);
        if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }
        if (strtolower(trim((string)$listing['owner_email'])) !== $sender) { \json_response(['error' => 'Not authorized'], 403); return; }

        $admins = DB::all("SELECT email FROM users WHERE is_admin = 1");
        $adminEmails = array_values(array_filter(array_map(function ($r) { return strtolower(trim((string)$r['email'])); }, $admins)));
        if (empty($adminEmails)) {
            $fallback = strtolower(trim((string)(getenv('ADMIN_EMAIL') ?: '')));
            if ($fallback) $adminEmails[] = $fallback;
        }
        if (empty($adminEmails)) { \json_response(['error' => 'Admin not configured'], 500); return; }

        $title = 'Payment note received';
        $msg = 'Seller note for listing #' . $listing['id'] . ' (“' . $listing['title'] . '”): ' . $noteText;
        $meta = json_encode(['sender_email' => $sender]);
        $stmt = DB::conn()->prepare("
          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
          VALUES (?, ?, ?, ?, 'payment_note', ?, ?)
        ");
        foreach ($adminEmails as $email) {
            try { $stmt->execute([$title, $msg, $email, gmdate('c'), $listing['id'], $meta]); } catch (\Throwable $e) {}
        }
        \json_response(['ok' => true]);
    }

    public static function draft(): void
    {
        self::ensureSchema();
        // Parse multipart
        $ownerEmailHeader = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        $ownerEmailBody = strtolower(trim((string)($_POST['owner_email'] ?? '')));
        $ownerEmail = $ownerEmailHeader ?: ($ownerEmailBody ?: null);

        $main_category = (string)($_POST['main_category'] ?? '');
        $title = (string)($_POST['title'] ?? '');
        $description = (string)($_POST['description'] ?? '');
        // Accept multiple possible field names from frontend for images
        $possibleFileKeys = ['images', 'images[]', 'image', 'photos', 'files'];
        $filesArr = [];
        foreach ($possibleFileKeys as $k) {
            if (!isset($_FILES[$k])) continue;
            $f = $_FILES[$k];
            if (is_array($f) && isset($f['tmp_name'])) {
                if (is_array($f['tmp_name'])) {
                    // Multiple files (name[] style)
                    $count = count($f['tmp_name']);
                    for ($i = 0; $i < $count; $i++) {
                        // Skip empty slots
                        if (empty($f['tmp_name'][$i]) || (isset($f['error'][$i]) && (int)$f['error'][$i] !== UPLOAD_ERR_OK)) continue;
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'][$i],
                            'name' => is_array($f['name']) ? ($f['name'][$i] ?? ('image-' . ($i + 1))) : ($f['name'] ?? ('image-' . ($i + 1))),
                            'type' => is_array($f['type']) ? ($f['type'][$i] ?? 'application/octet-stream') : ($f['type'] ?? 'application/octet-stream'),
                            'size' => is_array($f['size']) ? (int)($f['size'][$i] ?? 0) : (int)($f['size'] ?? 0),
                            'error' => is_array($f['error']) ? (int)($f['error'][$i] ?? UPLOAD_ERR_OK) : (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                } else {
                    // Single file (no [] in field name)
                    if (!empty($f['tmp_name']) && (int)($f['error'] ?? UPLOAD_ERR_OK) === UPLOAD_ERR_OK) {
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'],
                            'name' => $f['name'] ?? 'image-1',
                            'type' => $f['type'] ?? 'application/octet-stream',
                            'size' => (int)($f['size'] ?? 0),
                            'error' => (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                }
            }
            // If we found any files with this key, do not consider other keys
            if (!empty($filesArr)) break;
        }

        $userCategory = in_array($main_category, ['Vehicle','Property','Job','Electronic','Mobile','Home Garden','Other'], true) ? $main_category : null;
        $predicted = GeminiService::classifyMainCategory($title, $description);
        $selectedCategory = $userCategory ?: $predicted;

        // Validation
        if (!$title || strlen(trim($title)) < 3 || strlen(trim($title)) > 120) { \json_response(['error' => 'Title must be between 3 and 120 characters.'], 400); return; }
        if (!$description || strlen(trim($description)) < 10 || strlen(trim($description)) > 5000) { \json_response(['error' => 'Description must be between 10 and 5000 characters.'], 400); return; }
        if (empty($filesArr)) { \json_response(['error' => 'At least 1 image is required.'], 400); return; }
        if ($selectedCategory === 'Job' && count($filesArr) !== 1) { \json_response(['error' => 'Job listings must include exactly 1 image.'], 400); return; }

        $maxFiles = (in_array($selectedCategory, ['Mobile','Electronic','Home Garden'], true)) ? 4 : 5;
        if ($selectedCategory !== 'Job' && count($filesArr) > $maxFiles) { \json_response(['error' => 'Images: min 1, max ' . $maxFiles . '.'], 400); return; }
        foreach ($filesArr as $f) {
            if ($f['size'] > 5 * 1024 * 1024) { \json_response(['error' => 'File ' . $f['name'] . ' exceeds 5MB.'], 400); return; }
            $typeLower = strtolower((string)($f['type'] ?? ''));
            if ($typeLower === '' || strpos($typeLower, 'image/') !== 0) { \json_response(['error' => 'File ' . $f['name'] . ' is not an image.'], 400); return; }
            // Explicitly block SVG uploads (stored XSS risk)
            if ($typeLower === 'image/svg+xml' || str_ends_with(strtolower((string)($f['name'] ?? '')), '.svg')) {
                \json_response(['error' => 'SVG images are not allowed.'], 400); return;
            }
            // Lightweight magic signature + text guard
            $buf = @file_get_contents($f['tmp_name'], false, null, 0, 12);
            $looksText = $buf && (substr($buf, 0, 1) === '<' || stripos($buf, '<svg') !== false);
            if ($looksText) { \json_response(['error' => 'Invalid image format.'], 400); return; }
            // Do not reject other image formats here; we will try to convert to WebP, else keep original.
        }

        // Store images (best-effort WebP)
        $uploads = __DIR__ . '/../../../data/uploads';
        if (!is_dir($uploads)) @mkdir($uploads, 0775, true);
        $stored = [];
        foreach ($filesArr as $f) {
            if (!is_uploaded_file($f['tmp_name'])) { \json_response(['error' => 'Failed to read uploaded file.'], 400); return; }
            $base = bin2hex(random_bytes(8));
            $destWebp = $uploads . '/' . $base . '.webp';
            $pathFinal = null;

            try {
                if (class_exists('Imagick')) {
                    $img = new \Imagick($f['tmp_name']);
                    $img->setImageFormat('webp');
                    $img->resizeImage(1600, 0, \Imagick::FILTER_LANCZOS, 1, true);
                    $img->writeImage($destWebp);
                    $pathFinal = $destWebp;
                    $img->clear();
                    $img->destroy();
                } elseif (function_exists('imagewebp')) {
                    $mime = mime_content_type($f['tmp_name']) ?: '';
                    if (str_contains($mime, 'png')) $im = imagecreatefrompng($f['tmp_name']);
                    else $im = @imagecreatefromjpeg($f['tmp_name']);
                    if ($im !== false) {
                        $width = imagesx($im); $height = imagesy($im);
                        $newW = min(1600, $width);
                        $newH = (int) round($height * ($newW / max(1, $width)));
                        $dst = imagecreatetruecolor($newW, $newH);
                        imagecopyresampled($dst, $im, 0, 0, 0, 0, $newW, $newH, $width, $height);
                        imagewebp($dst, $destWebp, 80);
                        imagedestroy($dst);
                        imagedestroy($im);
                        $pathFinal = $destWebp;
                    }
                }
            } catch (\Throwable $e) { /* ignore, fallback below */ }

            if ($pathFinal === null) {
                // Fallback: move/copy original upload into uploads to ensure it is accessible
                $ext = '';
                $origName = (string)($f['name'] ?? '');
                if ($origName && str_contains($origName, '.')) {
                    $ext = '.' . strtolower(pathinfo($origName, PATHINFO_EXTENSION));
                } else {
                    $mime = mime_content_type($f['tmp_name']) ?: '';
                    if (str_contains($mime, 'png')) $ext = '.png';
                    elseif (str_contains($mime, 'webp')) $ext = '.webp';
                    elseif (str_contains($mime, 'gif')) $ext = '.gif';
                    elseif (str_contains($mime, 'tiff') || str_contains($mime, 'tif')) $ext = '.tif';
                    elseif (str_contains($mime, 'avif')) $ext = '.avif';
                    else $ext = '.jpg';
                }
                $destOrig = $uploads . '/' . $base . $ext;
                if (!@move_uploaded_file($f['tmp_name'], $destOrig)) {
                    @copy($f['tmp_name'], $destOrig);
                }
                $pathFinal = $destOrig;
            }

            // Original name derived from uploaded name, keep extension consistent with output file
            $stored[] = [
                'path' => $pathFinal,
                'original_name' => pathinfo($pathFinal, PATHINFO_BASENAME)
            ];
        }

        $listingPrompt = DB::one("SELECT content FROM prompts WHERE type = 'listing_extraction'")['content'] ?? '';
        $seoPrompt = DB::one("SELECT content FROM prompts WHERE type = 'seo_metadata'")['content'] ?? '';
        $baseContext = "Category: {$selectedCategory}\nTitle: {$title}\nDescription:\n{$description}";
        $userContext = $selectedCategory === 'Job'
            ? $baseContext . "\nIf the category is Job, extract job-specific fields (sub_category, employment_type, company, salary, salary_type, phone, location)."
            : $baseContext;

        $structured = GeminiService::extractStructured($selectedCategory, $title, $description);
        // wanted_tags_json (optional): up to 3 wanted IDs
        $wantedRaw = (string)($_POST['wanted_tags_json'] ?? '');
        $wanted = [];
        if ($wantedRaw !== '') {
            try {
                $arr = json_decode($wantedRaw, true);
                if (is_array($arr)) {
                    foreach ($arr as $x) {
                        $n = (int)$x;
                        if ($n > 0) $wanted[$n] = true;
                        if (count($wanted) >= 3) break;
                    }
                }
            } catch (\Throwable $e) {}
        }
        $wantedIds = array_slice(array_keys($wanted), 0, 3);
        $wantedJson = json_encode($wantedIds);

        // AI-powered SEO metadata
        $seoData = GeminiService::generateSeo($selectedCategory, $title, $description, $structured, $seoPrompt);
        $seo_title = (string)($seoData['seo_title'] ?? '');
        $seo_description = (string)($seoData['meta_description'] ?? '');
        $seo_keywords = (string)($seoData['seo_keywords'] ?? '');

        $ts = gmdate('c');
        DB::exec("
          INSERT INTO listing_drafts (main_category, title, description, structured_json, seo_title, seo_description, seo_keywords, owner_email, created_at, wanted_tags_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ", [$selectedCategory, $title, $description, json_encode($structured), $seo_title, $seo_description, $seo_keywords, $ownerEmail, $ts, $wantedJson]);
        $draftId = DB::lastInsertId();
        foreach ($stored as $s) {
            DB::exec("INSERT INTO listing_draft_images (draft_id, path, original_name) VALUES (?, ?, ?)", [$draftId, $s['path'], $s['original_name']]);
        }
        \json_response(['ok' => true, 'draftId' => $draftId]);
    }

    public static function draftGet(array $params): void
    {
        self::ensureSchema();
        // Micro-cache 15s per-id
        $cacheKey = 'draft-get:' . (int)($params['id'] ?? 0);
        $cached = self::cacheGet($cacheKey);
        if ($cached !== null) {
            header('Cache-Control: public, max-age=15');
            \json_response($cached);
            return;
        }

        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        $draft = DB::one("SELECT * FROM listing_drafts WHERE id = ?", [$id]);
        if (!$draft) { \json_response(['error' => 'Not found'], 404); return; }
        $images = DB::all("SELECT id, path, original_name FROM listing_draft_images WHERE draft_id = ? ORDER BY id ASC", [$id]);
        $payload = ['draft' => $draft, 'images' => $images];
        self::cacheSet($cacheKey, $payload, 15000);
        \json_response($payload);
    }

    public static function draftDelete(array $params): void
    {
        self::ensureSchema();
        $tok = JWT::getBearerToken();
        $v = $tok ? JWT::verify($tok) : ['ok' => false];
        if (!$v['ok']) { \json_response(['error' => 'Missing Authorization bearer token'], 401); return; }
        $claims = $v['decoded'];
        $email = strtolower((string)$claims['email']);
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        $draft = DB::one("SELECT owner_email FROM listing_drafts WHERE id = ?", [$id]);
        if (!$draft) { \json_response(['error' => 'Not found'], 404); return; }
        if (strtolower(trim((string)$draft['owner_email'])) !== $email) { \json_response(['error' => 'Not authorized'], 403); return; }
        $imgs = DB::all("SELECT path FROM listing_draft_images WHERE draft_id = ?", [$id]);
        foreach ($imgs as $im) { if (!empty($im['path'])) @unlink($im['path']); }
        DB::exec("DELETE FROM listing_draft_images WHERE draft_id = ?", [$id]);
        DB::exec("DELETE FROM listing_drafts WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function submit(): void
    {
        self::ensureSchema();
        $b = \read_body_json();
        $draftId = (int)($b['draftId'] ?? 0);
        $structured_json = (string)($b['structured_json'] ?? '');
        $description = (string)($b['description'] ?? '');
        if (!$draftId) { \json_response(['error' => 'draftId is required'], 400); return; }

        $draft = DB::one("SELECT * FROM listing_drafts WHERE id = ?", [$draftId]);
        if (!$draft) { \json_response(['error' => 'Draft not found'], 404); return; }
        $ownerEmail = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? ($draft['owner_email'] ?? ''))));
        if (!$ownerEmail) { \json_response(['error' => 'Missing user email'], 400); return; }

        $images = DB::all("SELECT * FROM listing_draft_images WHERE draft_id = ?", [$draftId]);
        if (count($images) === 0 && $draft['main_category'] !== 'Job') { \json_response(['error' => 'At least one image is required'], 400); return; }

        $finalStruct = json_decode($structured_json ?: '{}', true) ?: [];
        $finalStruct = array_merge($finalStruct, []); // normalize done by GeminiService earlier
        $location = (string)($finalStruct['location'] ?? '');
        $price = isset($finalStruct['price']) ? (float)$finalStruct['price'] : null;
        $pricing_type = (string)($finalStruct['pricing_type'] ?? '');
        $phone = (string)($finalStruct['phone'] ?? '');
        $model_name = (string)($finalStruct['model_name'] ?? '');
        $manufacture_year = isset($finalStruct['manufacture_year']) ? (int)$finalStruct['manufacture_year'] : null;
        $mainCat = (string)$draft['main_category'];

        if (!$location) { \json_response(['error' => 'Location is required'], 400); return; }
        if (!preg_match('/^\+94\d{9}$/', trim($phone))) { \json_response(['error' => 'Phone must be in +94XXXXXXXXX format'], 400); return; }

        if ($mainCat === 'Vehicle') {
            if ($price === null || !$pricing_type || !$model_name || $manufacture_year === null) { \json_response(['error' => 'For Vehicle: price, pricing type, model name, and manufacture year are required'], 400); return; }
            if (strlen(trim($model_name)) < 2) { \json_response(['error' => 'Model name must be at least 2 characters'], 400); return; }
            if ($manufacture_year < 1950 || $manufacture_year > 2100) { \json_response(['error' => 'Manufacture year must be a valid year between 1950 and 2100'], 400); return; }
        } else if ($mainCat === 'Job') {
            $sub = trim((string)($finalStruct['sub_category'] ?? ''));
            if (!$sub) { \json_response(['error' => 'Please specify a Job sub-category (e.g., Driver, IT/Software, Sales/Marketing)'], 400); return; }
            if ($price !== null && !$pricing_type) $finalStruct['pricing_type'] = 'Negotiable';
        } else {
            if ($price === null || !$pricing_type) { \json_response(['error' => 'Price and pricing type are required'], 400); return; }
        }

        $userDescription = trim($description ?: ($draft['description'] ?? ''));
        if (strlen($userDescription) < 10) { \json_response(['error' => 'Description must be at least 10 characters'], 400); return; }

        $ts = gmdate('c');
        $validUntil = gmdate('c', time() + ((int)$draft['employee_profile'] === 1 ? 90 : 30) * 24 * 3600);

        // Generate thumbnail (best-effort) from first image
        $thumbPath = null;
        $mediumPath = null;
        $ogPath = null;
        try {
            $firstImg = $images[0]['path'] ?? null;
            if ($firstImg && class_exists('Imagick')) {
                $img = new \Imagick($firstImg);
                $img->resizeImage(120, 90, \Imagick::FILTER_LANCZOS, 1, true);
                $thumbPath = dirname($firstImg) . '/' . pathinfo($firstImg, PATHINFO_FILENAME) . '-thumb.webp';
                $img->setImageFormat('webp');
                $img->writeImage($thumbPath);
                $img->clear(); $img->destroy();
                // OG image simplified
                $img2 = new \Imagick($firstImg);
                $img2->resizeImage(1200, 630, \Imagick::FILTER_LANCZOS, 1, true);
                $ogPath = dirname($firstImg) . '/' . pathinfo($firstImg, PATHINFO_FILENAME) . '-og.webp';
                $img2->setImageFormat('webp');
                $img2->writeImage($ogPath);
                $img2->clear(); $img2->destroy();
            }
        } catch (\Throwable $e) {}

        // remark number
        $remark = (string) random_int(1000, 9999);
        $existsStmt = DB::conn()->prepare("SELECT COUNT(*) AS c FROM listings WHERE remark_number = ?");
        $tries = 0;
        do {
            $existsStmt->execute([$remark]);
            $c = (int)($existsStmt->fetch(\PDO::FETCH_ASSOC)['c'] ?? 0);
            if ($c === 0) break;
            $remark = (string) random_int(1000, 9999);
            $tries++;
        } while ($tries < 20);

        DB::exec("
          INSERT INTO listings (main_category, title, description, structured_json, seo_title, seo_description, seo_keywords,
                                location, price, pricing_type, phone, owner_email, thumbnail_path, medium_path, og_image_path,
                                valid_until, status, created_at, model_name, manufacture_year, remark_number, employee_profile)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ", [$draft['main_category'], $draft['title'], $userDescription, json_encode($finalStruct), $draft['seo_title'], $draft['seo_description'], $draft['seo_keywords'],
            $location, $price, $finalStruct['pricing_type'] ?? $pricing_type, $phone, $ownerEmail, $thumbPath, $mediumPath, $ogPath,
            $validUntil, 'Pending Approval', $ts, $model_name, $manufacture_year, $remark, ((int)$draft['employee_profile'] === 1 ? 1 : 0)
        ]);
        $listingId = DB::lastInsertId();

        foreach ($images as $img) {
            DB::exec("INSERT INTO listing_images (listing_id, path, original_name, medium_path) VALUES (?, ?, ?, ?)", [$listingId, $img['path'], $img['original_name'], null]);
        }

        // Link wanted tags -> listing (best-effort)
        $wantedArr = [];
        try { $wantedArr = json_decode((string)($draft['wanted_tags_json'] ?? '[]'), true) ?: []; } catch (\Throwable $e) { $wantedArr = []; }
        if (is_array($wantedArr) && count($wantedArr)) {
            $ins = DB::conn()->prepare("INSERT OR IGNORE INTO listing_wanted_tags (listing_id, wanted_id, created_at) VALUES (?, ?, ?)");
            foreach ($wantedArr as $widRaw) {
                $wid = (int)$widRaw;
                if ($wid > 0) {
                    try { $ins->execute([$listingId, $wid, gmdate('c')]); } catch (\Throwable $e) {}
                }
            }
        }

        // Pending notification for owner
        if ($ownerEmail) {
            DB::exec("
              INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
              VALUES (?, ?, ?, ?, 'pending', ?)
            ", ['Listing submitted – Pending Approval', 'Your ad "' . $draft['title'] . "\" (#{$listingId}) has been submitted and is awaiting admin review.", $ownerEmail, gmdate('c'), $listingId]);
        }

        // Delete draft and images
        DB::exec("DELETE FROM listing_draft_images WHERE draft_id = ?", [$draftId]);
        DB::exec("DELETE FROM listing_drafts WHERE id = ?", [$draftId]);

        \json_response(['ok' => true, 'listingId' => $listingId, 'remark_number' => $remark]);
    }

    public static function my(): void
    {
        self::ensureSchema();
        $email = null;
        $tok = JWT::getBearerToken();
        $v = $tok ? JWT::verify($tok) : ['ok' => false];
        if ($v['ok']) {
            $email = strtolower((string)$v['decoded']['email']);
        } else {
            $headerEmail = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? '')));
            if ($headerEmail) {
                $email = $headerEmail;
            } else {
                \json_response(['error' => 'Missing Authorization bearer token or X-User-Email header'], 401);
                return;
            }
        }

        $rows = DB::all("
          SELECT id, main_category, title, description, seo_description, structured_json, price, pricing_type, location,
                 status, valid_until, created_at, reject_reason, views, is_urgent, employee_profile, thumbnail_path
          FROM listings
          WHERE LOWER(owner_email) = LOWER(?)
          ORDER BY id DESC
          LIMIT 200
        ", [$email]);

        $firstStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 1");
        $listStmt = DB::conn()->prepare("SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 5");

        $results = [];
        foreach ($rows as $r) {
            $firstStmt->execute([(int)$r['id']]);
            $first = $firstStmt->fetch(\PDO::FETCH_ASSOC) ?: null;
            $listStmt->execute([(int)$r['id']]);
            $imgs = $listStmt->fetchAll(\PDO::FETCH_ASSOC) ?: [];
            $thumbnail_url = self::filePathToUrl($r['thumbnail_path']) ?: self::filePathToUrl($first['medium_path'] ?? ($first['path'] ?? null));
            $small_images = array_values(array_filter(array_map(function ($x) { return self::filePathToUrl($x['medium_path'] ?? $x['path']); }, $imgs)));
            $results[] = [
                'id' => (int)$r['id'],
                'main_category' => $r['main_category'],
                'title' => $r['title'],
                'description' => $r['description'],
                'seo_description' => $r['seo_description'],
                'structured_json' => $r['structured_json'],
                'price' => $r['price'],
                'pricing_type' => $r['pricing_type'],
                'location' => $r['location'],
                'status' => $r['status'],
                'valid_until' => $r['valid_until'],
                'created_at' => $r['created_at'],
                'reject_reason' => $r['reject_reason'],
                'views' => (int)$r['views'],
                'is_urgent' => !!$r['is_urgent'],
                'urgent' => !!$r['is_urgent'],
                'employee_profile' => !!$r['employee_profile'],
                'thumbnail_url' => $thumbnail_url,
                'small_images' => $small_images,
            ];
        }

        \json_response(['results' => $results]);
    }

    public static function myDrafts(): void
    {
        self::ensureSchema();
        // Accept Bearer or X-User-Email (parity with Node behavior)
        $email = null;
        $tok = JWT::getBearerToken();
        $v = $tok ? JWT::verify($tok) : ['ok' => false];
        if ($v['ok']) {
            $email = strtolower((string)$v['decoded']['email']);
        } else {
            $headerEmail = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? '')));
            if ($headerEmail) {
                $email = $headerEmail;
            } else {
                \json_response(['error' => 'Missing Authorization bearer token or X-User-Email header'], 401);
                return;
            }
        }

        // Support optional employee_profile filter (1/true/yes)
        $empRaw = strtolower(trim((string)($_GET['employee_profile'] ?? '')));
        $employeeProfile = null;
        if ($empRaw !== '') {
            $employeeProfile = in_array($empRaw, ['1','true','yes'], true) ? 1 : 0;
        }

        $sql = "
          SELECT id, main_category, title, description, owner_email, created_at, employee_profile, resume_file_url
          FROM listing_drafts
          WHERE LOWER(owner_email) = LOWER(?)
        ";
        $params = [$email];
        if ($employeeProfile !== null) { $sql .= " AND employee_profile = ?"; $params[] = $employeeProfile; }
        $sql .= " ORDER BY id DESC LIMIT 200";
        $rows = DB::all($sql, $params);
        foreach ($rows as &$r) { $r['employee_profile'] = !!$r['employee_profile']; }
        \json_response(['results' => $rows]);
    }

    public static function delete(array $params): void
    {
        self::ensureSchema();
        $tok = JWT::getBearerToken();
        $v = $tok ? JWT::verify($tok) : ['ok' => false];
        if (!$v['ok']) { \json_response(['error' => 'Missing Authorization bearer token'], 401); return; }
        $email = strtolower((string)$v['decoded']['email']);
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        $row = DB::one("SELECT owner_email, thumbnail_path FROM listings WHERE id = ?", [$id]);
        if (!$row) { \json_response(['error' => 'Not found'], 404); return; }
        if (strtolower(trim((string)$row['owner_email'])) !== $email) { \json_response(['error' => 'Not authorized'], 403); return; }
        $imgs = DB::all("SELECT path, medium_path FROM listing_images WHERE listing_id = ?", [$id]);
        foreach ($imgs as $im) { if (!empty($im['path'])) @unlink($im['path']); if (!empty($im['medium_path'])) @unlink($im['medium_path']); }
        DB::exec("DELETE FROM listing_images WHERE listing_id = ?", [$id]);
        if (!empty($row['thumbnail_path'])) @unlink($row['thumbnail_path']);
        DB::exec("DELETE FROM listings WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function describe(): void
    {
        self::ensureSchema();
        $b = \read_body_json();
        $draftId = (int)($b['draftId'] ?? 0);
        if (!$draftId) { \json_response(['error' => 'draftId is required'], 400); return; }
        $draft = DB::one("SELECT id, main_category, title, description, structured_json FROM listing_drafts WHERE id = ?", [$draftId]);
        if (!$draft) { \json_response(['error' => 'Draft not found'], 404); return; }
        $sj = json_decode((string)($b['structured_json'] ?? ($draft['structured_json'] ?? '{}')), true) ?: [];
        $cat = (string)($draft['main_category'] ?? 'Other');
        $title = (string)($draft['title'] ?? '');
        $desc = (string)($draft['description'] ?? '');

        // Use Gemini when available to generate a clean, emoji-enhanced description; otherwise fallback formatting.
        $text = \App\Services\GeminiService::generateDescription($cat, $title, $desc, $sj);
        \json_response(['ok' => true, 'description' => $text]);
    }

    public static function vehicleSpecs(): void
    {
        // Align schema to Node: { manufacturer?, engine_capacity_cc?, transmission?, fuel_type?, colour?, mileage_km? }
        $b = \read_body_json();
        $model = trim((string)($b['model_name'] ?? ''));
        $desc = trim((string)($b['description'] ?? ''));
        $sub = trim((string)($b['sub_category'] ?? ''));
        if (!$model) { \json_response(['error' => 'model_name is required'], 400); return; }

        $text = trim($model . ' ' . $sub . ' ' . $desc);

        // Manufacturer from a simple brand list
        $brands = ['Toyota','Honda','Nissan','Mazda','Mitsubishi','Hyundai','Kia','Suzuki','Subaru','Ford','Chevrolet','BMW','Mercedes','Audi','Volkswagen','Peugeot','Renault','Tata','Mahindra','Bajaj','Yamaha','Hero','TVS','Kawasaki','Royal Enfield','Vespa'];
        $manufacturer = null;
        foreach ($brands as $br) {
            if (stripos($text, $br) !== false) { $manufacturer = $br; break; }
        }

        // Engine capacity (cc)
        $engine_capacity_cc = null;
        if (preg_match('/\b([5-9]\d{2}|[1-7]\d{3}|8000)\b/', preg_replace('/[^\d]/', ' ', $text), $m)) {
            $cc = (int)$m[1];
            if ($cc >= 50 && $cc <= 8000) $engine_capacity_cc = $cc;
        }

        // Transmission
        $transmission = null;
        $low = strtolower($text);
        if (strpos($low, 'auto') !== false || strpos($low, 'automatic') !== false) $transmission = 'Automatic';
        elseif (strpos($low, 'manual') !== false) $transmission = 'Manual';
        elseif ($sub && stripos($sub, 'bike') !== false) $transmission = 'Manual';

        // Fuel type
        $fuel_type = null;
        if (strpos($low, 'diesel') !== false) $fuel_type = 'Diesel';
        elseif (strpos($low, 'hybrid') !== false) $fuel_type = 'Hybrid';
        elseif (strpos($low, 'electric') !== false || strpos($low, 'ev') !== false) $fuel_type = 'Electric';
        elseif (strpos($low, 'petrol') !== false || strpos($low, 'gasoline') !== false || strpos($low, 'benzine') !== false) $fuel_type = 'Petrol';

        // Colour (best-effort from common colors)
        $colour = null;
        $colors = ['black','white','silver','grey','gray','blue','red','green','yellow','gold','brown','beige','maroon','orange','purple'];
        foreach ($colors as $c) {
            if (preg_match('/\b' . preg_quote($c, '/') . '\b/i', $low)) { $colour = ucfirst($c === 'gray' ? 'Grey' : $c); break; }
        }

        // Mileage (km)
        $mileage_km = null;
        if (preg_match('/\b([0-9]{3,7})\s*(km|kms|kilometers|kilometres)\b/i', $low, $mm)) {
            $mileage_km = (int)$mm[1];
        } elseif (preg_match('/\b([0-9]{3,7})\b/', str_replace(',', '', $low), $mm)) {
            $val = (int)$mm[1];
            if ($val >= 100 && $val <= 1000000) $mileage_km = $val;
        }
        if (is_int($mileage_km)) {
            $mileage_km = max(0, min(1000000, $mileage_km));
        }

        $result = [];
        if ($manufacturer) $result['manufacturer'] = $manufacturer;
        if ($engine_capacity_cc !== null) $result['engine_capacity_cc'] = $engine_capacity_cc;
        if ($transmission) $result['transmission'] = $transmission;
        if ($fuel_type) $result['fuel_type'] = $fuel_type;
        if ($colour) $result['colour'] = $colour;
        if ($mileage_km !== null) $result['mileage_km'] = $mileage_km;

        \json_response(['ok' => true, 'specs' => $result]);
    }

    public static function filters(): void
    {
        self::ensureSchema();
        // Micro-cache 60s per-URL
        $cacheKey = 'filters:' . (string)($_SERVER['REQUEST_URI'] ?? '');
        $cached = self::cacheGet($cacheKey);
        if ($cached !== null) {
            header('Cache-Control: public, max-age=60');
            \json_response($cached);
            return;
        }

        $category = trim((string)($_GET['category'] ?? ''));
        if (!$category) { \json_response(['error' => 'category is required'], 400); return; }

        // Load recent approved listings for the category
        $rows = DB::all("SELECT title, description, structured_json, location FROM listings WHERE status = 'Approved' AND main_category = ? ORDER BY id DESC LIMIT 800", [$category]);

        // Build dynamic keys from structured_json across rows
        $keysMap = [];
        $valuesByKey = [];

        $baseKeys = ['sub_category','model_name','location','pricing_type'];
        foreach ($baseKeys as $bk) { $keysMap[$bk] = true; $valuesByKey[$bk] = []; }

        $inferVehicleSub = function (string $title, string $desc) {
            $t = strtolower($title . ' ' . $desc);
            if (preg_match('/\b(bike|motorcycle|scooter)\b/i', $t)) return 'Bike';
            if (preg_match('/\b(car|sedan|hatchback|suv)\b/i', $t)) return 'Car';
            if (preg_match('/\b(van)\b/i', $t)) return 'Van';
            if (preg_match('/\b(bus)\b/i', $t)) return 'Bus';
            return null;
        };

        foreach ($rows as $r) {
            $sj = json_decode((string)($r['structured_json'] ?? '{}'), true) ?: [];
            // Accumulate keys present
            foreach ($sj as $k => $v) {
                if (!is_scalar($v)) continue;
                $k = (string)$k;
                if ($k === '') continue;
                $keysMap[$k] = true;
                if (!isset($valuesByKey[$k])) $valuesByKey[$k] = [];
                $val = trim((string)$v);
                if ($val !== '') $valuesByKey[$k][$val] = true;
            }
            // Ensure location also captured
            $loc = trim((string)($r['location'] ?? ''));
            if ($loc !== '') { $valuesByKey['location'][$loc] = true; }

            // Special: for Vehicle ensure sub_category is present or inferred
            if ($category === 'Vehicle') {
                $sub = trim((string)($sj['sub_category'] ?? ''));
                if ($sub === '') {
                    $inf = $inferVehicleSub((string)($r['title'] ?? ''), (string)($r['description'] ?? ''));
                    if ($inf) { $valuesByKey['sub_category'][$inf] = true; }
                }
            }
        }

        // Normalize keys and prepare limited values
        $keys = array_keys($keysMap);
        // Keep only a reasonable set to avoid noisy UI
        // Always include base keys first
        $preferred = $baseKeys;
        $otherKeys = array_values(array_diff($keys, $preferred));
        sort($otherKeys);
        $keys = array_values(array_unique(array_merge($preferred, $otherKeys)));

        $outMap = [];
        foreach ($keys as $k) {
            $vals = array_keys($valuesByKey[$k] ?? []);
            sort($vals, SORT_NATURAL | SORT_FLAG_CASE);
            $outMap[$k] = array_values(array_slice($vals, 0, 50));
        }

        $payload = ['keys' => $keys, 'valuesByKey' => $outMap];
        self::cacheSet($cacheKey, $payload, 60000);
        header('Cache-Control: public, max-age=60');
        \json_response($payload);
    }

    private static function requireDraftOwnerEmail(int $draftId): ?string
    {
        $email = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        $draft = DB::one("SELECT owner_email FROM listing_drafts WHERE id = ?", [$draftId]);
        if (!$draft) { \json_response(['error' => 'Draft not found'], 404); return null; }
        $owner = strtolower(trim((string)($draft['owner_email'] ?? '')));
        if (!$email || !$owner || $email !== $owner) { \json_response(['error' => 'Not authorized'], 403); return null; }
        return $email;
    }

    public static function draftImageAdd(array $params): void
    {
        self::ensureSchema();
        $draftId = (int)($params['id'] ?? 0);
        if (!$draftId) { \json_response(['error' => 'Invalid id'], 400); return; }
        if (!self::requireDraftOwnerEmail($draftId)) return;

        $draft = DB::one("SELECT main_category FROM listing_drafts WHERE id = ?", [$draftId]);
        if (!$draft) { \json_response(['error' => 'Draft not found'], 404); return; }
        $cat = (string)$draft['main_category'];

        $existing = DB::all("SELECT id FROM listing_draft_images WHERE draft_id = ?", [$draftId]);
        $currentCount = count($existing);
        $maxFiles = (in_array($cat, ['Mobile','Electronic','Home Garden'], true)) ? 4 : ($cat === 'Job' ? 1 : 5);

        // Parse files
        $possibleFileKeys = ['images', 'images[]', 'image', 'photos', 'files'];
        $filesArr = [];
        foreach ($possibleFileKeys as $k) {
            if (!isset($_FILES[$k])) continue;
            $f = $_FILES[$k];
            if (is_array($f) && isset($f['tmp_name'])) {
                if (is_array($f['tmp_name'])) {
                    $count = count($f['tmp_name']);
                    for ($i = 0; $i < $count; $i++) {
                        if (empty($f['tmp_name'][$i]) || (isset($f['error'][$i]) && (int)$f['error'][$i] !== UPLOAD_ERR_OK)) continue;
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'][$i],
                            'name' => is_array($f['name']) ? ($f['name'][$i] ?? ('image-' . ($i + 1))) : ($f['name'] ?? ('image-' . ($i + 1))),
                            'type' => is_array($f['type']) ? ($f['type'][$i] ?? 'application/octet-stream') : ($f['type'] ?? 'application/octet-stream'),
                            'size' => is_array($f['size']) ? (int)($f['size'][$i] ?? 0) : (int)($f['size'] ?? 0),
                            'error' => is_array($f['error']) ? (int)($f['error'][$i] ?? UPLOAD_ERR_OK) : (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                } else {
                    if (!empty($f['tmp_name']) && (int)($f['error'] ?? UPLOAD_ERR_OK) === UPLOAD_ERR_OK) {
                        $filesArr[] = [
                            'tmp_name' => $f['tmp_name'],
                            'name' => $f['name'] ?? 'image-1',
                            'type' => $f['type'] ?? 'application/octet-stream',
                            'size' => (int)($f['size'] ?? 0),
                            'error' => (int)($f['error'] ?? UPLOAD_ERR_OK),
                        ];
                    }
                }
            }
            if (!empty($filesArr)) break;
        }

        if (empty($filesArr)) { \json_response(['error' => 'No images uploaded'], 400); return; }
        if ($cat === 'Job' && ($currentCount + count($filesArr)) > 1) { \json_response(['error' => 'Job listings must include exactly 1 image.'], 400); return; }
        if ($cat !== 'Job' && ($currentCount + count($filesArr)) > $maxFiles) { \json_response(['error' => 'Too many images. Max ' . $maxFiles . '.'], 400); return; }
        foreach ($filesArr as $f) {
            if ($f['size'] > 5 * 1024 * 1024) { \json_response(['error' => 'File ' . $f['name'] . ' exceeds 5MB.'], 400); return; }
            $typeLower = strtolower((string)($f['type'] ?? ''));
            if ($typeLower === '' || strpos($typeLower, 'image/') !== 0) { \json_response(['error' => 'File ' . $f['name'] . ' is not an image.'], 400); return; }
            if ($typeLower === 'image/svg+xml' || str_ends_with(strtolower((string)($f['name'] ?? '')), '.svg')) {
                \json_response(['error' => 'SVG images are not allowed.'], 400); return;
            }
            $buf = @file_get_contents($f['tmp_name'], false, null, 0, 12);
            $looksText = $buf && (substr($buf, 0, 1) === '<' || stripos($buf, '<svg') !== false);
            if ($looksText) { \json_response(['error' => 'Invalid image format.'], 400); return; }
            // Accept broader image/* types; conversion attempted below.
        }

        $uploads = __DIR__ . '/../../../data/uploads';
        if (!is_dir($uploads)) @mkdir($uploads, 0775, true);
        $stored = [];
        foreach ($filesArr as $f) {
            if (!is_uploaded_file($f['tmp_name'])) { \json_response(['error' => 'Failed to read uploaded file.'], 400); return; }
            $base = bin2hex(random_bytes(8));
            $destWebp = $uploads . '/' . $base . '.webp';
            $pathFinal = null;

            try {
                if (class_exists('Imagick')) {
                    $img = new \Imagick($f['tmp_name']);
                    $img->setImageFormat('webp');
                    $img->resizeImage(1600, 0, \Imagick::FILTER_LANCZOS, 1, true);
                    $img->writeImage($destWebp);
                    $pathFinal = $destWebp;
                    $img->clear(); $img->destroy();
                } elseif (function_exists('imagewebp')) {
                    $mime = mime_content_type($f['tmp_name']) ?: '';
                    if (str_contains($mime, 'png')) $im = imagecreatefrompng($f['tmp_name']);
                    else $im = @imagecreatefromjpeg($f['tmp_name']);
                    if ($im !== false) {
                        $width = imagesx($im); $height = imagesy($im);
                        $newW = min(1600, $width);
                        $newH = (int) round($height * ($newW / max(1, $width)));
                        $dst = imagecreatetruecolor($newW, $newH);
                        imagecopyresampled($dst, $im, 0, 0, 0, 0, $newW, $newH, $width, $height);
                        imagewebp($dst, $destWebp, 80);
                        imagedestroy($dst); imagedestroy($im);
                        $pathFinal = $destWebp;
                    }
                }
            } catch (\Throwable $e) {}

            if ($pathFinal === null) {
                $ext = '';
                $origName = (string)($f['name'] ?? '');
                if ($origName && str_contains($origName, '.')) {
                    $ext = '.' . strtolower(pathinfo($origName, PATHINFO_EXTENSION));
                } else {
                    $mime = mime_content_type($f['tmp_name']) ?: '';
                    if (str_contains($mime, 'png')) $ext = '.png';
                    elseif (str_contains($mime, 'webp')) $ext = '.webp';
                    elseif (str_contains($mime, 'gif')) $ext = '.gif';
                    elseif (str_contains($mime, 'tiff') || str_contains($mime, 'tif')) $ext = '.tif';
                    elseif (str_contains($mime, 'avif')) $ext = '.avif';
                    else $ext = '.jpg';
                }
                $destOrig = $uploads . '/' . $base . $ext;
                if (!@move_uploaded_file($f['tmp_name'], $destOrig)) { @copy($f['tmp_name'], $destOrig); }
                $pathFinal = $destOrig;
            }

            $stored[] = ['path' => $pathFinal, 'original_name' => pathinfo($pathFinal, PATHINFO_BASENAME)];
        }

        foreach ($stored as $s) {
            DB::exec("INSERT INTO listing_draft_images (draft_id, path, original_name) VALUES (?, ?, ?)", [$draftId, $s['path'], $s['original_name']]);
        }

        $images = DB::all("SELECT id, path, original_name FROM listing_draft_images WHERE draft_id = ? ORDER BY id ASC", [$draftId]);
        \json_response(['ok' => true, 'images' => $images]);
    }

    public static function draftImageDelete(array $params): void
    {
        self::ensureSchema();
        $draftId = (int)($params['id'] ?? 0);
        $imgId = (int)($params['imageId'] ?? 0);
        if (!$draftId || !$imgId) { \json_response(['error' => 'Invalid id'], 400); return; }
        if (!self::requireDraftOwnerEmail($draftId)) return;

        $row = DB::one("SELECT path FROM listing_draft_images WHERE id = ? AND draft_id = ?", [$imgId, $draftId]);
        if (!$row) { \json_response(['error' => 'Not found'], 404); return; }
        if (!empty($row['path'])) @unlink($row['path']);
        DB::exec("DELETE FROM listing_draft_images WHERE id = ? AND draft_id = ?", [$imgId, $draftId]);
        \json_response(['ok' => true]);
    }
}