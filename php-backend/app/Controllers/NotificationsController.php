<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\SSE;

class NotificationsController
{
    private static function requireUserHeader(): ?array
    {
        $email = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        if (!$email) {
            \json_response(['error' => 'Missing user email'], 401);
            return null;
        }
        $u = DB::one("SELECT id, is_banned, suspended_until FROM users WHERE email = ?", [$email]);
        if (!$u) { \json_response(['error' => 'Invalid user'], 401); return null; }
        if (!empty($u['is_banned'])) { \json_response(['error' => 'Account banned'], 403); return null; }
        if (!empty($u['suspended_until']) && (strtotime($u['suspended_until']) > time())) {
            \json_response(['error' => 'Account suspended'], 403); return null;
        }
        return ['id' => (int)$u['id'], 'email' => $email];
    }

    public static function list(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $limit = min((int)($_GET['limit'] ?? 50), 200);
        $readCutoffIso = gmdate('c', time() - 24 * 3600);
        $unreadCutoffIso = gmdate('c', time() - 7 * 24 * 3600);
        $rows = DB::all("
            SELECT n.id, n.title, n.message, n.target_email, n.created_at, n.type, n.listing_id, n.meta_json, n.emailed_at,
                   CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS is_read,
                   r.read_at as read_at
            FROM notifications n
            LEFT JOIN notification_reads r
              ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
            WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
              AND (
                n.type = 'pending'
                OR (r.id IS NOT NULL AND r.read_at >= ?)
                OR (r.id IS NULL AND n.created_at >= ?)
              )
            ORDER BY n.id DESC
            LIMIT ?
        ", [$email, $email, $readCutoffIso, $unreadCutoffIso, $limit]);

        $unreadCount = 0;
        foreach ($rows as $r) { $unreadCount += ((int)$r['is_read'] ? 0 : 1); }
        \json_response(['results' => $rows, 'unread_count' => $unreadCount]);
    }

    public static function unreadCount(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $unreadCutoffIso = gmdate('c', time() - 7 * 24 * 3600);
        $row = DB::one("
            SELECT COUNT(*) as c
            FROM notifications n
            LEFT JOIN notification_reads r
              ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
            WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
              AND r.id IS NULL
              AND (n.type = 'pending' OR n.created_at >= ?)
        ", [$email, $email, $unreadCutoffIso]);
        \json_response(['unread_count' => (int)($row['c'] ?? 0)]);
    }

    public static function markRead(array $params): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        DB::exec("INSERT OR IGNORE INTO notification_reads (notification_id, user_email, read_at) VALUES (?, ?, ?)", [$id, $email, gmdate('c')]);
        \json_response(['ok' => true]);
    }

    public static function savedSearchCreate(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $body = \read_body_json();
        $name = trim((string)($body['name'] ?? ''));
        $category = trim((string)($body['category'] ?? ''));
        $location = trim((string)($body['location'] ?? ''));
        $price_min = isset($body['price_min']) ? (float)$body['price_min'] : null;
        $price_max = isset($body['price_max']) ? (float)$body['price_max'] : null;
        $filters_json = '{}';
        try { $filters_json = json_encode($body['filters'] ?? []); } catch (\Throwable $e) {}
        DB::exec("
          INSERT INTO saved_searches (user_email, name, category, location, price_min, price_max, filters_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ", [$email, $name, $category, $location, $price_min, $price_max, $filters_json, gmdate('c')]);
        \json_response(['ok' => true]);
    }

    public static function savedSearchList(): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $rows = DB::all("
          SELECT id, name, category, location, price_min, price_max, filters_json, created_at
          FROM saved_searches
          WHERE LOWER(user_email) = LOWER(?)
          ORDER BY id DESC
          LIMIT 100
        ", [$email]);
        \json_response(['results' => $rows]);
    }

    public static function savedSearchDelete(array $params): void
    {
        $u = self::requireUserHeader(); if (!$u) return;
        $email = $u['email'];
        $id = (int)($params['id'] ?? 0);
        if (!$id) { \json_response(['error' => 'Invalid id'], 400); return; }
        $row = DB::one("SELECT user_email FROM saved_searches WHERE id = ?", [$id]);
        if (!$row || strtolower(trim($row['user_email'] ?? '')) !== $email) {
            \json_response(['error' => 'Not found'], 404);
            return;
        }
        DB::exec("DELETE FROM saved_searches WHERE id = ?", [$id]);
        \json_response(['ok' => true]);
    }

    public static function savedSearchNotifyForListing(): void
    {
        $body = \read_body_json();
        $listingId = (int)($body['listingId'] ?? 0);
        if (!$listingId) { \json_response(['error' => 'Invalid listingId'], 400); return; }
        $listing = DB::one("SELECT id, title, main_category, location, price, structured_json, created_at FROM listings WHERE id = ?", [$listingId]);
        if (!$listing) { \json_response(['error' => 'Listing not found'], 404); return; }

        $searches = DB::all("SELECT * FROM saved_searches");
        $notified = 0;

        foreach ($searches as $s) {
            if (self::listingMatchesSearch($listing, $s)) {
                DB::exec("
                  INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                  VALUES (?, ?, ?, ?, 'saved_search', ?, ?)
                ", [
                    'New listing matches your search',
                    'A new "' . ($listing['title'] ?? '') . '" matches your saved search.',
                    $s['user_email'],
                    gmdate('c'),
                    $listing['id'],
                    json_encode(['saved_search_id' => $s['id']])
                ]);
                $notified++;
            }
        }
        \json_response(['ok' => true, 'notified' => $notified]);
    }

    private static function listingMatchesSearch(array $listing, array $search): bool
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

    public static function unreadStream(): void
    {
        $emailHeader = strtolower(trim($_SERVER['HTTP_X_USER_EMAIL'] ?? ''));
        $emailQuery = strtolower(trim($_GET['user_email'] ?? ''));
        $email = $emailHeader ?: $emailQuery;
        if (!$email) { \text_response(json_encode(['error' => 'Missing user email']), 401, 'application/json'); return; }
        $user = DB::one("SELECT id, is_banned, suspended_until FROM users WHERE email = ?", [$email]);
        if (!$user) { \text_response(json_encode(['error' => 'Invalid user']), 401, 'application/json'); return; }
        if (!empty($user['is_banned'])) { \text_response(json_encode(['error' => 'Account banned']), 403, 'application/json'); return; }
        if (!empty($user['suspended_until']) && (strtotime($user['suspended_until']) > time())) {
            \text_response(json_encode(['error' => 'Account suspended']), 403, 'application/json'); return;
        }

        // Heuristic: PHP built-in dev server (cli-server) handles requests serially.
        // Long-lived SSE connections can block other API calls. In that environment,
        // return a single event and close quickly so the browser reconnects via polling.
        $isCliServer = (PHP_SAPI === 'cli-server');

        @set_time_limit(0);

        SSE::start();

        $computeUnread = function () use ($email) {
            $cut = gmdate('c', time() - 7 * 24 * 3600);
            $row = DB::one("
                SELECT COUNT(*) as c
                FROM notifications n
                LEFT JOIN notification_reads r
                  ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
                WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
                  AND r.id IS NULL
                  AND (n.type = 'pending' OR n.created_at >= ?)
            ", [$email, $email, $cut]);
            return (int) ($row['c'] ?? 0);
        };

        // Always send an initial event
        SSE::event('unread_count', ['unread_count' => $computeUnread()]);

        if ($isCliServer) {
            // Close immediately to avoid blocking other requests in dev server.
            echo ": closing\n\n";
            flush();
            exit;
        }

        $intervalMs = 30000;
        $lastEvent = microtime(true);
        $lastHb = microtime(true);

        $endAt = microtime(true) + 25.0; // end before 30s to avoid fatal timeout; client will reconnect

        while (!connection_aborted() && microtime(true) < $endAt) {
            $now = microtime(true);
            if (($now - $lastEvent) * 1000 >= $intervalMs) {
                SSE::event('unread_count', ['unread_count' => $computeUnread()]);
                $lastEvent = $now;
            }
            if (($now - $lastHb) >= 15) {
                SSE::heartbeat();
                $lastHb = $now;
            }
            usleep(250000);
        }
        // Explicitly end stream so EventSource reconnects quickly
        echo ": closing\n\n";
        flush();
        exit;
    }
}