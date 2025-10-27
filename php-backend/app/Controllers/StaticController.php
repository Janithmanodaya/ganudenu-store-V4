<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\SSE;

class StaticController
{
    public static function robots(): void
    {
        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
        $txt = "User-agent: *\nAllow: /\nSitemap: {$domain}/sitemap.xml";
        header('Cache-Control: public, max-age=600');
        \text_response($txt, 200, 'text/plain');
    }

    public static function sitemap(): void
    {
        $domain = getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store';
        $rows = DB::all("SELECT id, title, structured_json, created_at FROM listings WHERE status = 'Approved' ORDER BY id DESC LIMIT 3000");
        $nowIso = gmdate('c');

        $core = [
            ['loc' => $domain . '/', 'lastmod' => $nowIso],
            ['loc' => $domain . '/jobs', 'lastmod' => $nowIso],
            ['loc' => $domain . '/search', 'lastmod' => $nowIso],
            ['loc' => $domain . '/policy', 'lastmod' => $nowIso]
        ];

        $makeSlug = function ($s) {
            $base = strtolower(preg_replace('/[^a-z0-9]+/', '-', $s));
            $base = preg_replace('/^-+|-+$/', '', $base);
            return $base ? substr($base, 0, 80) : 'listing';
        };
        $safeLastMod = function ($v) use ($nowIso) {
            if (!$v) return $nowIso;
            $d = strtotime($v);
            return $d ? gmdate('c', $d) : $nowIso;
        };
        $xmlEscape = function ($str) {
            return htmlspecialchars($str, ENT_QUOTES | ENT_XML1, 'UTF-8');
        };

        $urls = $core;
        foreach ($rows as $r) {
            $year = '';
            try {
                $sj = json_decode($r['structured_json'] ?? '{}', true);
                $y = $sj['manufacture_year'] ?? $sj['year'] ?? $sj['model_year'] ?? null;
                if ($y) {
                    $yy = (int) $y;
                    if ($yy >= 1950 && $yy <= 2100) $year = (string)$yy;
                }
            } catch (\Throwable $e) {}
            $idCode = strtoupper(base_convert((string)$r['id'], 10, 36));
            $parts = array_filter([$makeSlug($r['title'] ?? ''), $year, $idCode]);
            $rawLoc = "{$domain}/listing/{$r['id']}-" . implode('-', $parts);
            $loc = $xmlEscape(rawurlencode($rawLoc));
            $urls[] = ['loc' => $loc, 'lastmod' => $safeLastMod($r['created_at'] ?? null)];
        }

        $items = array_map(function ($u) use ($xmlEscape) {
            return "<url><loc>{$u['loc']}</loc><lastmod>{$xmlEscape($u['lastmod'])}</lastmod></url>";
        }, $urls);

        $xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" .
               implode("\n", $items) . "\n</urlset>";
        header('Cache-Control: public, max-age=600');
        \xml_response($xml, 200);
    }

    public static function banners(): void
    {
        try {
            $rows = DB::all("SELECT id, path FROM banners WHERE active = 1 ORDER BY sort_order ASC, id DESC LIMIT 12");
            $items = [];
            foreach ($rows as $r) {
                $filename = basename((string)($r['path'] ?? ''));
                $url = $filename ? "/uploads/{$filename}" : null;
                if ($url) $items[] = ['id' => (int)$r['id'], 'url' => $url];
            }
            \json_response(['results' => $items]);
        } catch (\Throwable $e) {
            \json_response(['error' => 'Failed to load banners'], 500);
        }
    }

    public static function maintenanceStatus(): void
    {
        try {
            $row = DB::one("SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1");
            \json_response(['enabled' => !!($row && $row['maintenance_mode']), 'message' => $row['maintenance_message'] ?? '']);
        } catch (\Throwable $e) {
            \json_response(['enabled' => false, 'message' => '']);
        }
    }

    public static function maintenanceStream(): void
    {
        // Allow long-lived SSE without timing out (especially under PHP built-in server)
        @set_time_limit(0);
        SSE::start();
        $current = function () {
            $row = DB::one("SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1");
            return ['enabled' => !!($row && $row['maintenance_mode']), 'message' => $row['maintenance_message'] ?? ''];
        };
        SSE::event('maintenance_status', $current());
        $hb = 15;
        $interval = 30;
        $lastEvent = time();
        $lastHb = time();
        while (!connection_aborted()) {
            $now = time();
            if ($now - $lastEvent >= $interval) {
                SSE::event('maintenance_status', $current());
                $lastEvent = $now;
            }
            if ($now - $lastHb >= $hb) {
                SSE::heartbeat();
                $lastHb = $now;
            }
            usleep(250000);
        }
        exit;
    }
}