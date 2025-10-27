<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\EmailService;

class NotificationDigestController
{
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
        if (!$row || !(int)$row['is_admin']) { \json_response(['error' => 'Forbidden'], 403); return null; }
        if (strtolower($row['email']) !== strtolower((string)$claims['email'])) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['id' => (int)$row['id'], 'email' => strtolower($row['email'])];
    }

    // Group pending saved_search notifications and email digests, then mark emailed_at.
    public static function savedSearchDigest(): void
    {
        $admin = self::requireAdmin(); if (!$admin) return;

        $cutoff = gmdate('c', time() - 24 * 3600);
        $rows = DB::all("
          SELECT id, title, message, target_email, created_at, listing_id, meta_json
          FROM notifications
          WHERE type = 'saved_search'
            AND (emailed_at IS NULL OR TRIM(emailed_at) = '')
            AND created_at >= ?
          ORDER BY target_email ASC, id ASC
          LIMIT 500
        ", [$cutoff]);

        if (empty($rows)) { \json_response(['ok' => true, 'sent' => 0]); return; }

        $byUser = [];
        foreach ($rows as $r) {
            $email = strtolower(trim((string)$r['target_email']));
            if (!$email) continue;
            $byUser[$email] = $byUser[$email] ?? [];
            $byUser[$email][] = $r;
        }

        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
        $sentCount = 0;

        foreach ($byUser as $email => $items) {
            // Fetch listing titles for links
            $listingIds = array_values(array_unique(array_map(fn($x) => (int)($x['listing_id'] ?? 0), $items)));
            $listingMap = [];
            if (!empty($listingIds)) {
                $ph = implode(',', array_fill(0, count($listingIds), '?'));
                $listings = DB::all("SELECT id, title FROM listings WHERE id IN ($ph)", $listingIds);
                foreach ($listings as $l) { $listingMap[(int)$l['id']] = $l['title']; }
            }

            $html = '<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">'
                . '<h2 style="margin:0 0 10px 0;">New matches for your saved searches</h2>'
                . '<ul style="margin:0;padding-left:18px;">';
            foreach ($items as $it) {
                $lid = (int)($it['listing_id'] ?? 0);
                $title = $listingMap[$lid] ?? '';
                $html .= '<li>'
                    . htmlspecialchars($title ?: (string)($it['message'] ?? ''), ENT_QUOTES, 'UTF-8')
                    . ($lid ? ' — <a href="' . $domain . '/listing/' . $lid . '" style="color:#0b5fff;text-decoration:none;">View</a>' : '')
                    . '</li>';
            }
            $html .= '</ul></div>';

            $res = EmailService::send($email, 'New matches for your saved searches', $html);
            if (!empty($res['ok'])) {
                $sentCount++;
                // Mark emailed_at for all included notifications
                $now = gmdate('c');
                $upd = DB::conn()->prepare("UPDATE notifications SET emailed_at = ? WHERE id = ?");
                foreach ($items as $it) {
                    $upd->execute([$now, (int)$it['id']]);
                }
            }
        }

        \json_response(['ok' => true, 'sent' => $sentCount]);
    }
}