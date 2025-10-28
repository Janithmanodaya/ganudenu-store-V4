<?php
namespace App\Services;

use App\Router;
use ReflectionMethod;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use FilesystemIterator;

class MiniMap
{
    // Where to store the generated minimap JSON (publicly fetchable if needed)
    private static function outputFile(): string
    {
        $base = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        // In repo layout, public index is at php-backend/public/index.php, so place under public/var.
        // In host-deploy layout, index.php is at api/index.php (no public/). Then use api/var instead.
        $pubDir = $base . '/public';
        $varDir = is_dir($pubDir) ? ($pubDir . '/var') : ($base . '/var');
        if (!is_dir($varDir)) @mkdir($varDir, 0775, true);
        return $varDir . '/minimap.json';
    }

    // Simple should-rebuild logic: if file missing or older than interval seconds (default 300)
    private static function shouldRebuild(string $file): bool
    {
        $interval = (int)(getenv('MINIMAP_UPDATE_INTERVAL') ?: 300);
        if (!is_file($file)) return true;
        $age = time() - (int)filemtime($file);
        return $age >= max(30, $interval);
    }

    private static function uploadsBase(): array
    {
        // Resolve uploads base path (do not enumerate contents)
        $base = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');
        $envUploads = getenv('UPLOADS_PATH') ?: '';
        $uploads = $envUploads && is_dir($envUploads) ? $envUploads : ($base . '/data/uploads');
        return [
            'path' => $uploads,
            'exists' => is_dir($uploads),
            'writable' => is_dir($uploads) ? is_writable($uploads) : false
        ];
    }

    private static function listFiles(string $root): array
    {
        // Enumerate a safe subset of files (skip node_modules, vendor, .git, uploads)
        $skipDirs = [
            '/node_modules/',
            '/.git/',
            '/php-backend/vendor/',
            '/php-backend/public/var/',
            '/php-backend/database/',
            '/php-backend/tests/',
        ];
        $uploads = self::uploadsBase()['path'];
        $filters = ['php','js','ts','jsx','tsx','json','yaml','yml','md','html','css','sh','cmd','ps1','bat','conf','ini'];
        $filtersMap = array_fill_keys(array_map('strtolower', $filters), true);

        $out = [];
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );
        foreach ($it as $file) {
            if (!$file->isFile()) continue;
            $path = $file->getRealPath();
            if (!$path) continue;
            $path = str_replace('\\', '/', $path);

            // Skip uploads content
            if ($uploads && str_starts_with($path, str_replace('\\', '/', realpath($uploads) ?: $uploads))) {
                continue;
            }
            // Skip configured dirs
            $skip = false;
            foreach ($skipDirs as $sd) {
                if (str_contains($path, $sd)) { $skip = true; break; }
            }
            if ($skip) continue;

            $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
            if (!isset($filtersMap[$ext])) continue;

            // Save relative path to repo root
            $out[] = [
                'path' => self::relPath($root, $path),
                'size' => (int)($file->getSize() ?: 0),
                'mtime' => (int)($file->getMTime() ?: 0),
                'ext' => $ext
            ];
        }
        return $out;
    }

    private static function relPath(string $root, string $abs): string
    {
        $root = rtrim(str_replace('\\', '/', $root), '/');
        $abs = str_replace('\\', '/', $abs);
        if (str_starts_with($abs, $root . '/')) {
            return substr($abs, strlen($root) + 1);
        }
        return $abs;
    }

    // Build route map by introspecting available controllers and methods AND by relying on AutoRoutes canonical map
    private static function buildRoutesMap(): array
    {
        // Lazily include AutoRoutes to derive canonical routes
        if (!class_exists(\App\Services\AutoRoutes::class)) {
            require __DIR__ . '/AutoRoutes.php';
        }
        $routes = \App\Services\AutoRoutes::generateCanonical();
        // Only include those whose controller::method exists
        $filtered = [];
        foreach ($routes as $r) {
            $class = $r['controller'] ?? null;
            $method = $r['action'] ?? null;
            if (!$class || !$method) { $filtered[] = $r; continue; }
            if (class_exists($class) && method_exists($class, $method)) {
                $filtered[] = $r;
            }
        }
        return $filtered;
    }

    public static function buildIfNeeded(): void
    {
        $outFile = self::outputFile();
        if (!self::shouldRebuild($outFile)) return;

        $repoRoot = realpath(__DIR__ . '/../../..') ?: (__DIR__ . '/../../..');

        $data = [
            'generated_at' => gmdate('c'),
            'root' => $repoRoot,
            'uploads' => self::uploadsBase(),
            'files' => $selfFiles = self::listFiles($repoRoot),
            'apis' => self::buildRoutesMap()
        ];

        @file_put_contents($outFile, json_encode($data, JSON_PRETTY_PRINT));
    }

    public static function currentMap(): array
    {
        $outFile = self::outputFile();
        if (!is_file($outFile)) return [];
        $raw = @file_get_contents($outFile);
        if (!$raw) return [];
        $obj = json_decode($raw, true);
        return is_array($obj) ? $obj : [];
    }
}