<?php
namespace App\Controllers;

use App\Services\DB;

class WantedController
{
    private static function requireUser(): ?array
    {
        $email = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        if (!$email) { \json_response(['error' => 'Missing user email'], 401); return null; }
        $u = DB::one("SELECT id FROM users WHERE email = ?", [$email]);
        if (!$u) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['email' => $email, 'id' => (int)$u['id']];
    }

    private static function ensureSchema(): void
    {
        DB::exec("
          CREATE TABLE IF NOT EXISTS wanted_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            category TEXT,
            location TEXT,
            price_max REAL,
            filters_json TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            created_at TEXT NOT NULL,
            locations_json TEXT,
            models_json TEXT,
            year_min INTEGER,
            year_max INTEGER,
            price_min REAL,
            price_not_matter INTEGER NOT NULL DEFAULT 0
          )
        ");
        DB::exec("CREATE INDEX IF NOT EXISTS idx_wanted_status ON wanted_requests(status)");
        DB::exec("CREATE INDEX IF NOT EXISTS idx_wanted_user ON wanted_requests(user_email)");
        DB::exec("CREATE INDEX IF NOT EXISTS idx_wanted_category ON wanted_requests(category)");
        DB::exec("CREATE INDEX IF NOT EXISTS idx_wanted_created ON wanted_requests(created_at)");
    }

    public static function create(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $b = \read_body_json();
        $title = trim((string)($b['title'] ?? ''));
        $description = trim((string)($b['description'] ?? ''));
        $category = trim((string)($b['category'] ?? ''));
        $locations = is_array($b['locations'] ?? null) ? array_values(array_filter(array_map('strval', $b['locations']))) : [];
        $models = is_array($b['models'] ?? null) ? array_values(array_filter(array_map('strval', $b['models']))) : [];
        $year_min = isset($b['year_min']) && $b['year_min'] !== '' ? (int)$b['year_min'] : null;
        $year_max = isset($b['year_max']) && $b['year_max'] !== '' ? (int)$b['year_max'] : null;
        $price_min = isset($b['price_min']) && $b['price_min'] !== '' ? (float)$b['price_min'] : null;
        $price_max = isset($b['price_max']) && $b['price_max'] !== '' ? (float)$b['price_max'] : null;
        $price_not_matter = !empty($b['price_not_matter']) ? 1 : 0;
        $filters = $b['filters'] ?? [];

        if (!$title || strlen($title) < 6) { \json_response(['error' => 'Title must be at least 6 characters'], 400); return; }
        if ($year_min !== null && ($year_min < 1950 || $year_min > 2100)) { \json_response(['error' => 'Invalid year_min'], 400); return; }
        if ($year_max !== null && ($year_max < 1950 || $year_max > 2100)) { \json_response(['error' => 'Invalid year_max'], 400); return; }
        if ($price_min !== null && $price_min < 0) { \json_response(['error' => 'Invalid price_min'], 400); return; }
        if ($price_max !== null && $price_max < 0) { \json_response(['error' => 'Invalid price_max'], 400); return; }

        $filters_json = '{}';
        try { $filters_json = json_encode($filters ?: []); } catch (\Throwable $e) {}

        DB::exec("
          INSERT INTO wanted_requests (user_email, title, description, category, location, price_max, filters_json, status, created_at,
                                       locations_json, models_json, year_min, year_max, price_min, price_not_matter)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
        ", [$u['email'], $title, $description, $category ?: null, ($locations[0] ?? null), $price_max, $filters_json, gmdate('c'),
            json_encode($locations), json_encode($models), $year_min, $year_max, $price_min, $price_not_matter
        ]);
        $id = DB::lastInsertId();

        // Notify buyer that request was posted
        DB::exec("
          INSERT INTO notifications (title, message, target_email, created_at, type, meta_json)
          VALUES (?, ?, ?, ?, 'wanted_posted', ?)
        ", ['Your Wanted request was posted',
             ($price_not_matter ? 'We will notify you when new matching ads are listed.' : 'We will notify you when new matching ads are listed.'),
             $u['email'], gmdate('c'), json_encode(['wanted_id' => $id])]);

        \json_response(['ok' => true, 'id' => $id]);
    }

    public static function list(): void
    {
        self::ensureSchema();
        try {
            $q = (string)($_GET['q'] ?? '');
            $category = (string)($_GET['category'] ?? '');
            $location = (string)($_GET['location'] ?? '');
            $limit = max(1, min(200, (int)($_GET['limit'] ?? 50)));
            $sql = "
              SELECT w.id, w.user_email, u.username AS poster_username, w.title, w.description, w.category, w.location,
                     w.price_min, w.price_max, w.price_not_matter, w.filters_json, w.locations_json, w.models_json,
                     w.year_min, w.year_max, w.status, w.created_at
              FROM wanted_requests w
              LEFT JOIN users u ON LOWER(u.email) = LOWER(w.user_email)
              WHERE w.status = 'open'
            ";
            $params = [];
            if ($category) { $sql .= " AND w.category = ?"; $params[] = $category; }
            if ($location) { $sql .= " AND (LOWER(w.location) LIKE ? OR LOWER(COALESCE(w.locations_json,'')) LIKE ?)"; $params[] = '%' . strtolower($location) . '%'; $params[] = '%' . strtolower($location) . '%'; }
            if ($q) {
                $term = '%' . strtolower($q) . '%';
                $sql .= " AND (LOWER(w.title) LIKE ? OR LOWER(w.description) LIKE ?)";
                array_push($params, $term, $term);
            }
            $sql .= " ORDER BY w.created_at DESC LIMIT ?";
            $params[] = $limit;
            $rows = DB::all($sql, $params);
            \json_response(['results' => $rows]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load wanted requests'], 500);
        }
    }

    public static function my(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $rows = DB::all("
          SELECT w.id, w.user_email, u.username AS poster_username, w.title, w.description, w.category, w.location,
                 w.price_min, w.price_max, w.price_not_matter, w.filters_json, w.locations_json, w.models_json,
                 w.year_min, w.year_max, w.status, w.created_at
          FROM wanted_requests w
          LEFT JOIN users u ON LOWER(u.email) = LOWER(w.user_email)
          WHERE LOWER(w.user_email) = LOWER(?)
          ORDER BY w.id DESC
          LIMIT 200
        ", [$u['email']]);
        \json_response(['results' => $rows]);
    }

    public static function close(array $params): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        $row = DB::one("SELECT user_email, status FROM wanted_requests WHERE id = ?", [$id]);
        if (!$row) { \json_response(['error' => 'Not found'], 404); return; }
        if (strtolower(trim((string)$row['user_email'])) !== $u['email']) { \json_response(['error' => 'Not authorized'], 403); return; }
        DB::exec("UPDATE wanted_requests SET status = ? WHERE id = ?", ['closed', $id]);
        \json_response(['ok' => true]);
    }

    public static function respond(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $b = \read_body_json();
        $wid = (int)($b['wanted_id'] ?? 0);
        $lid = (int)($b['listing_id'] ?? 0);
        $message = trim((string)($b['message'] ?? ''));
        if (!$wid || !$lid) { \json_response(['error' => 'wanted_id and listing_id are required'], 400); return; }
        $wanted = DB::one("SELECT * FROM wanted_requests WHERE id = ?", [$wid]);
        if (!$wanted || $wanted['status'] !== 'open') { \json_response(['error' => 'Wanted request not open'], 404); return; }
        $listing = DB::one("SELECT id, title, owner_email FROM listings WHERE id = ?", [$lid]);
        if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }
        $owner = strtolower(trim((string)$listing['owner_email']));
        if ($owner !== $u['email']) { \json_response(['error' => 'You can only respond with your own listing'], 403); return; }

        DB::exec("
          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
          VALUES (?, ?, ?, ?, 'wanted_response', ?, ?)
        ", ['A seller responded to your Wanted request', 'Seller offered: "' . $listing['title'] . '". ' . $message, strtolower(trim((string)$wanted['user_email'])), gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$wanted['id'], 'seller_email' => $u['email']])]);

        DB::exec("
          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
          VALUES (?, ?, ?, ?, 'wanted_response_sent', ?, ?)
        ", ['Your offer was sent', 'We notified the buyer about your ad "' . $listing['title'] . '".', $u['email'], gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$wanted['id']])]);

        \json_response(['ok' => true]);
    }

    public static function notifyForListing(): void
    {
        self::ensureSchema();
        $b = \read_body_json();
        $id = (int)($b['listingId'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid listingId'], 400); return; }
        $listing = DB::one("SELECT id, title, main_category, location, price, structured_json, owner_email FROM listings WHERE id = ?", [$id]);
        if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }
        $wantedRows = DB::all("SELECT * FROM wanted_requests WHERE status = 'open'");
        $buyerNotified = 0;
        $sellerNotified = 0;
        foreach ($wantedRows as $w) {
            if (self::listingMatchesWanted($listing, $w)) {
                DB::exec("
                  INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                  VALUES (?, ?, ?, ?, 'wanted_match_buyer', ?, ?)
                ", ['New ad matches your Wanted request', 'Match: "' . $listing['title'] . '". View the ad for details.', strtolower(trim((string)$w['user_email'])), gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                $buyerNotified++;
                $owner = strtolower(trim((string)$listing['owner_email']));
                if ($owner) {
                    DB::exec("
                      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                      VALUES (?, ?, ?, ?, 'wanted_match_seller', ?, ?)
                    ", ['Immediate buyer request for your item', 'A buyer posted: "' . $w['title'] . '". Your ad may match.', $owner, gmdate('c'), $listing['id'], json_encode(['wanted_id' => (int)$w['id']])]);
                    $sellerNotified++;
                }
            }
        }
        \json_response(['ok' => true, 'buyerNotified' => $buyerNotified, 'sellerNotified' => $sellerNotified]);
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
            if (in_array($cat, ['Vehicle','Mobile','Electronic'], true)) {
                $models = json_decode((string)($wanted['models_json'] ?? '[]'), true) ?: [];
                if ($models) {
                    $sj = json_decode((string)($listing['structured_json'] ?? '{}'), true) ?: [];
                    $gotModel = strtolower((string)($sj['model_name'] ?? $sj['model'] ?? ''));
                    $modelsOk = array_reduce($models, function ($acc, $m) use ($gotModel) { return $acc || ($gotModel && stripos($gotModel, strtolower((string)$m)) !== false); }, false);
                }
            }

            $yearOk = true;
            if ($cat === 'Vehicle') {
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
}