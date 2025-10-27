<?php
namespace App;

use App\Services\RateLimiter;

class Router
{
    private $routes = [];

    public function add(string $method, string $pattern, callable $handler, ?array $opts = null): void
    {
        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => $pattern,
            'handler' => $handler,
            'opts' => $opts ?? []
        ];
    }

    private function matchPath(string $pattern, string $path): ?array
    {
        // Convert pattern with :param into regex
        $re = preg_replace('#:([A-Za-z_][A-Za-z0-9_]*)#', '(?P<$1>[^/]+)', $pattern);
        $re = '#^' . $re . '$#';
        if (preg_match($re, $path, $m)) {
            $params = [];
            foreach ($m as $k => $v) {
                if (!is_int($k)) $params[$k] = $v;
            }
            return $params;
        }
        return null;
    }

    public function dispatch(): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $uri = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?: '/';

        foreach ($this->routes as $r) {
            if ($r['method'] !== $method) continue;
            $params = $this->matchPath($r['pattern'], $path);
            if ($params === null) continue;

            // Rate limit per route group with defaults when env missing
            $group = $r['opts']['rate_group'] ?? null;
            if ($group) {
                $gUpper = strtoupper($group);
                $defaults = [
                    'GLOBAL' => ['max' => 120, 'win' => 60000],
                    'AUTH' => ['max' => 60, 'win' => 60000],
                    'ADMIN' => ['max' => 90, 'win' => 60000],
                    'LISTINGS' => ['max' => 60, 'win' => 60000],
                ];
                $maxEnv = getenv("RATE_{$gUpper}_MAX");
                $winEnv = getenv("RATE_{$gUpper}_WINDOW_MS");
                $max = (int) ($maxEnv !== false ? $maxEnv : 0);
                $win = (int) ($winEnv !== false ? $winEnv : 0);
                if ((!$max || !$win) && isset($defaults[$gUpper])) {
                    $def = $defaults[$gUpper];
                    if (!$max) {
                        $max = (int) $def['max'];
                        @putenv("RATE_{$gUpper}_MAX={$max}");
                        $_ENV["RATE_{$gUpper}_MAX"] = (string)$max;
                    }
                    if (!$win) {
                        $win = (int) $def['win'];
                        @putenv("RATE_{$gUpper}_WINDOW_MS={$win}");
                        $_ENV["RATE_{$gUpper}_WINDOW_MS"] = (string)$win;
                    }
                }
                if ($max && $win) {
                    if (!RateLimiter::check(strtolower($gUpper), $max, $win)) {
                        http_response_code(429);
                        header('Content-Type: application/json');
                        echo json_encode(['error' => 'Too Many Requests']);
                        return;
                    }
                }
            }

            // Call handler
            ($r['handler'])($params);
            return;
        }

        // 404
        http_response_code(404);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'Not found']);
    }
}