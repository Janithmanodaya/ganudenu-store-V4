<?php
require __DIR__ . '/../app/bootstrap.php';

use App\Services\DB;
use App\Services\EmailService;

$task = null;
for ($i = 1; $i < $_SERVER['argc']; $i++) {
    if (preg_match('/^--task=(.+)$/', $_SERVER['argv'][$i], $m)) {
        $task = $m[1];
    }
}
if (!$task) {
    echo "Usage: php scheduler.php --task=<task-name>\n";
    echo "Tasks: purgeExpiredListings, purgeOldChats, purgeOldWantedRequests, sendSavedSearchEmailDigests\n";
    exit(0);
}

switch ($task) {
    case 'purgeExpiredListings':
        purgeExpiredListings();
        break;
    case 'purgeOldChats':
        purgeOldChats();
        break;
    case 'purgeOldWantedRequests':
        purgeOldWantedRequests();
        break;
    case 'sendSavedSearchEmailDigests':
        sendSavedSearchEmailDigests();
        break;
    default:
        echo "Unknown task: {$task}\n";
        exit(1);
}

function purgeExpiredListings(): void
{
    $now = gmdate('c');
    $rows = DB::all("SELECT id, thumbnail_path, medium_path, og_image_path FROM listings WHERE valid_until IS NOT NULL AND valid_until <= ?", [$now]);
    $purged = 0;
    foreach ($rows as $r) {
        $lid = (int)$r['id'];

        // Delete generated top-level image variants
        if (!empty($r['thumbnail_path'])) @unlink($r['thumbnail_path']);
        if (!empty($r['medium_path'])) @unlink($r['medium_path']);
        if (!empty($r['og_image_path'])) @unlink($r['og_image_path']);

        // Delete child images from disk and table
        $imgs = DB::all("SELECT path, medium_path FROM listing_images WHERE listing_id = ?", [$lid]);
        foreach ($imgs as $img) {
            if (!empty($img['path'])) @unlink($img['path']);
            if (!empty($img['medium_path'])) @unlink($img['medium_path']);
        }
        DB::exec("DELETE FROM listing_images WHERE listing_id = ?", [$lid]);

        // Clean up related rows (reports, views, wanted tags, notifications referencing listing)
        DB::exec("DELETE FROM reports WHERE listing_id = ?", [$lid]);
        DB::exec("DELETE FROM listing_views WHERE listing_id = ?", [$lid]);
        DB::exec("DELETE FROM listing_wanted_tags WHERE listing_id = ?", [$lid]);
        DB::exec("DELETE FROM notifications WHERE listing_id = ?", [$lid]);

        // Finally delete the listing row
        DB::exec("DELETE FROM listings WHERE id = ?", [$lid]);

        $purged++;
    }
    echo "Deleted {$purged} expired listings\n";
}

function purgeOldChats(): void
{
    $cutoff = gmdate('c', time() - 7 * 24 * 3600);
    $changes = DB::exec("DELETE FROM chats WHERE created_at < ?", [$cutoff]);
    echo "Purged {$changes} chat messages older than 7 days\n";
}

function purgeOldWantedRequests(): void
{
    // Delete Wanted requests older than 10 days (regardless of status), including related notifications
    $cutoff = gmdate('c', time() - 10 * 24 * 3600);
    $rows = DB::all("SELECT id FROM wanted_requests WHERE created_at < ?", [$cutoff]);
    $deleted = 0;
    foreach ($rows as $r) {
        $wid = (int)$r['id'];
        // Remove notifications linking to this wanted request (stored in meta_json)
        DB::exec("DELETE FROM notifications WHERE meta_json LIKE ?", ['%\"wanted_id\":' . $wid . '%']);
        // Delete the request itself
        DB::exec("DELETE FROM wanted_requests WHERE id = ?", [$wid]);
        $deleted++;
    }
    echo "Deleted {$deleted} wanted requests older than 10 days\n";
}

function sendSavedSearchEmailDigests(): void
{
    // For each user with saved searches, compute matches in last 24h and email summary (best-effort).
    $cutoff = gmdate('c', time() - 24 * 3600);
    $searches = DB::all("SELECT * FROM saved_searches");
    $listings = DB::all("SELECT id, title, main_category, location, price, structured_json, created_at FROM listings WHERE status = 'Approved' AND created_at >= ? ORDER BY created_at DESC LIMIT 500", [$cutoff]);

    $group = [];
    foreach ($searches as $s) {
        $email = strtolower(trim((string)$s['user_email']));
        if (!$email) continue;
        foreach ($listings as $l) {
            if (listingMatchesSearch($l, $s)) {
                $group[$email] = $group[$email] ?? [];
                $group[$email][] = $l;
                if (count($group[$email]) >= 20) break;
            }
        }
    }
    foreach ($group as $email => $items) {
        $html = "<div style=\"font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;\">";
        $html .= "<h2 style=\"margin:0 0 10px 0;\">New matches for your saved searches</h2>";
        $html .= "<ul style=\"margin:0;padding-left:18px;\">";
        foreach ($items as $l) {
            $html .= "<li>" . htmlspecialchars($l['title']) . " — " . htmlspecialchars($l['main_category']) . "</li>";
        }
        $html .= "</ul></div>";
        $sent = EmailService::send($email, 'New matches for your saved searches', $html);
        if ($sent['ok']) {
            echo "Digest sent to {$email} (" . count($items) . ")\n";
        } else {
            echo "Digest failed for {$email}: " . ($sent['error'] ?? '') . "\n";
        }
    }
}

function listingMatchesSearch(array $listing, array $search): bool
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