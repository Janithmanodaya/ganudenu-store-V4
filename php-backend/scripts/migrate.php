<?php
require __DIR__ . '/../app/bootstrap.php';

use App\Services\DB;

function applyMigrationFile(string $path): void {
    $sql = file_get_contents($path);
    if ($sql === false) {
        fwrite(STDERR, "Failed to read migration: {$path}\n");
        exit(1);
    }
    try {
        DB::conn()->exec($sql);
        echo "Applied migration: {$path}\n";
    } catch (Throwable $e) {
        fwrite(STDERR, "Migration error in {$path}: " . $e->getMessage() . "\n");
        exit(1);
    }
}

$dir = realpath(__DIR__ . '/../database/migrations');
if (!$dir) {
    fwrite(STDERR, "Migrations directory not found.\n");
    exit(1);
}
$files = glob($dir . '/*.sql');
sort($files);
foreach ($files as $f) {
    applyMigrationFile($f);
}

echo "PRAGMAs applied; migrations complete.\n";