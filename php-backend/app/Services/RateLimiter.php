<?php
namespace App\Services;

class RateLimiter
{
    private static function key(string $name): string
    {
        $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        return "rl:" . $name . ":" . $ip;
    }

    public static function check(string $name, int $max, int $windowMs): bool
    {
        $now = (int) (microtime(true) * 1000);
        $key = self::key($name);
        $entry = null;

        if (function_exists('apcu_fetch')) {
            $entry = apcu_fetch($key);
        } else {
            $tmp = sys_get_temp_dir() . '/ganudenu_rl_' . md5($key) . '.json';
            if (is_file($tmp)) {
                $entry = json_decode((string) @file_get_contents($tmp), true);
            }
        }

        if (!is_array($entry)) {
            $entry = ['start' => $now, 'count' => 0];
        }
        if ($now - (int)$entry['start'] > $windowMs) {
            $entry['start'] = $now;
            $entry['count'] = 0;
        }
        $entry['count'] += 1;
        $ok = $entry['count'] <= $max;

        if (function_exists('apcu_store')) {
            apcu_store($key, $entry, (int)ceil($windowMs / 1000));
        } else {
            $tmp = sys_get_temp_dir() . '/ganudenu_rl_' . md5($key) . '.json';
            @file_put_contents($tmp, json_encode($entry));
        }
        return $ok;
    }
}