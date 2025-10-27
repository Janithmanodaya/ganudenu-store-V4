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
                $max = ($maxEnv !== false) ? (int) $maxEnv : null;
                $win = ($winEnv !== false) ? (int) $winEnv : null;
                if (isset($defaults[$gUpper])) {
                    $def = $defaults[$gUpper];
                    if ($max === null) {
                        $max = (int) $def['max'];
                        @putenv("RATE_{$gUpper}_MAX={$max}");
                        $_ENV["RATE_{$gUpper}_MAX"] = (string)$max;
                    }
                    if ($win === null) {
                        $win = (int) $def['win'];
                        @putenv("RATE_{$gUpper}_WINDOW_MS={$win}");
                        $_ENV["RATE_{$gUpper}_WINDOW_MS"] = (string)$win;
                    }
                }
                $maxVal = (int) ($max ?? 0);
                $winVal = (int) ($win ?? 0);
                if ($maxVal && $winVal) {
                    if (!RateLimiter::check(strtolower($gUpper), $maxVal, $winVal)) {
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