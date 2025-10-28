<?php
namespace App\Controllers;

use App\Services\DB;

class UsersController
{
    private static function findUser(?string $handle): ?array
    {
        if (!$handle) return null;
        $handle = strtolower(trim($handle));
        $u = DB::one("SELECT id, email, username, profile_photo_path FROM users WHERE LOWER(username) = LOWER(?)", [$handle]);
        if ($u) return $u;
        if (str_contains($handle, '@')) {
            $ue = DB::one("SELECT id, email, username, profile_photo_path FROM users WHERE LOWER(email) = LOWER(?)", [$handle]);
            if ($ue) return $ue;
        }
        return null;
    }

    public static function profileGet(): void
    {
        try {
            // Accept username or email; if missing/undefined, fallback to auth token or header
            $raw = (string)($_GET['username'] ?? ($_GET['email'] ?? ''));
            $handle = strtolower(trim($raw));
            if ($handle === '' || $handle === 'undefined' || $handle === 'null') {
                // Try Bearer token or auth_token cookie
                $tok = \App\Services\JWT::getBearerToken();
                if (!$tok && isset($_COOKIE['auth_token'])) {
                    $tok = (string)$_COOKIE['auth_token'];
                }
                if ($tok) {
                    $v = \App\Services\JWT::verify($tok);
                    if ($v['ok'] && !empty($v['decoded']['email'])) {
                        $handle = strtolower(trim((string)$v['decoded']['email']));
                    }
                }
                // Fallback to X-User-Email header
                if ($handle === '' || $handle === 'undefined' || $handle === 'null') {
                    $hdr = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? '')));
                    if ($hdr !== '') $handle = $hdr;
                }
            }

            $user = self::findUser($handle);
            if (!$user) { \json_response(['error' => 'Seller not found'], 404); return; }
            $photo_url = !empty($user['profile_photo_path']) ? ('/uploads/' . basename($user['profile_photo_path'])) : null;
            DB::exec("
              CREATE TABLE IF NOT EXISTS seller_profiles (
                user_email TEXT PRIMARY KEY,
                bio TEXT,
                verified_email INTEGER NOT NULL DEFAULT 0,
                verified_phone INTEGER NOT NULL DEFAULT 0,
                rating_avg REAL NOT NULL DEFAULT 0,
                rating_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT
              )
            ");
            DB::exec("
              CREATE TABLE IF NOT EXISTS seller_ratings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_email TEXT NOT NULL,
                rater_email TEXT NOT NULL,
                listing_id INTEGER,
                stars INTEGER NOT NULL,
                comment TEXT,
                created_at TEXT NOT NULL
              )
            ");
            $profile = DB::one("SELECT * FROM seller_profiles WHERE LOWER(user_email) = LOWER(?)", [$user['email']]) ?: [
                'user_email' => $user['email'], 'bio' => '', 'verified_email' => 0, 'verified_phone' => 0, 'rating_avg' => 0, 'rating_count' => 0, 'updated_at' => null
            ];
            $nowIso = gmdate('c');
            $stats = DB::one("
              SELECT
                (
                  SELECT COUNT(*)
                  FROM listings
                  WHERE LOWER(owner_email) = LOWER(?)
                    AND status = 'Approved'
                    AND (valid_until IS NULL OR valid_until > ?)
                ) AS active_listings,
                (
                  SELECT COUNT(*)
                  FROM seller_ratings
                  WHERE LOWER(seller_email) = LOWER(?)
                ) AS ratings_count
            ", [$user['email'], $nowIso, $user['email']]);
            $ratings = DB::all("
              SELECT sr.id, u.id AS rater_id, sr.listing_id, sr.stars, sr.comment, sr.created_at
              FROM seller_ratings sr
              LEFT JOIN users u ON LOWER(u.email) = LOWER(sr.rater_email)
              WHERE LOWER(sr.seller_email) = LOWER(?)
              ORDER BY sr.id DESC
            ", [$user['email']]);
            \json_response(['ok' => true, 'user' => ['email' => $user['email'], 'username' => $user['username'], 'photo_url' => $photo_url], 'profile' => $profile, 'stats' => $stats, 'ratings' => $ratings]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load profile'], 500);
        }
    }

    public static function requireUserHeader(): ?array
    {
        $email = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        if (!$email) { \json_response(['error' => 'Missing user email'], 401); return null; }
        $u = DB::one("SELECT id FROM users WHERE email = ?", [$email]);
        if (!$u) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['email' => $email, 'id' => (int)$u['id']];
    }

    public static function profilePost(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $bio = trim((string)(\read_body_json()['bio'] ?? ''));
        $verified_email = !empty(\read_body_json()['verified_email']) ? 1 : 0;
        $verified_phone = !empty(\read_body_json()['verified_phone']) ? 1 : 0;
        $now = gmdate('c');
        DB::exec("
          INSERT INTO seller_profiles (user_email, bio, verified_email, verified_phone, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_email) DO UPDATE SET bio=excluded.bio, verified_email=excluded.verified_email, verified_phone=excluded.verified_phone, updated_at=excluded.updated_at
        ", [$u['email'], $bio, $verified_email, $verified_phone, $now]);
        \json_response(['ok' => true]);
    }

    public static function rate(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $b = \read_body_json();
        $seller_email = strtolower(trim((string)($b['seller_email'] ?? '')));
        $listing_id = isset($b['listing_id']) ? (int)$b['listing_id'] : null;
        $stars = (int)($b['stars'] ?? 0);
        $comment = trim((string)($b['comment'] ?? ''));
        if (!$seller_email || $seller_email === $u['email']) { \json_response(['error' => 'Invalid seller'], 400); return; }
        if ($stars < 1 || $stars > 5) { \json_response(['error' => 'Stars must be 1-5'], 400); return; }
        $existing = DB::one("SELECT id FROM seller_ratings WHERE LOWER(seller_email) = LOWER(?) AND LOWER(rater_email) = LOWER(?) LIMIT 1", [$seller_email, $u['email']]);
        if ($existing) { \json_response(['error' => 'You have already rated this seller.'], 409); return; }
        DB::exec("
          INSERT INTO seller_ratings (seller_email, rater_email, listing_id, stars, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        ", [$seller_email, $u['email'], $listing_id ?: null, $stars, $comment, gmdate('c')]);

        $agg = DB::one("SELECT AVG(stars) as avg, COUNT(*) as cnt FROM seller_ratings WHERE LOWER(seller_email) = LOWER(?)", [$seller_email]);
        DB::exec("
          INSERT INTO seller_profiles (user_email, rating_avg, rating_count, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_email) DO UPDATE SET rating_avg=excluded.rating_avg, rating_count=excluded.rating_count, updated_at=excluded.updated_at
        ", [$seller_email, number_format((float)($agg['avg'] ?? 0), 2), (int)($agg['cnt'] ?? 0), gmdate('c')]);

        \json_response(['ok' => true]);
    }
}