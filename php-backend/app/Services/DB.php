<?php
namespace App\Services;

use PDO;
use PDOException;

class DB
{
    private static ?PDO $pdo = null;

    public static function conn(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }
        $dbPath = getenv('DB_PATH') ?: (__DIR__ . '/../../../data/ganudenu.sqlite');
        $dir = dirname($dbPath);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        $dsn = 'sqlite:' . $dbPath;
        $pdo = new PDO($dsn);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

        // PRAGMAs for parity
        try { $pdo->exec("PRAGMA journal_mode = WAL"); } catch (PDOException $e) {}
        try { $pdo->exec("PRAGMA synchronous = NORMAL"); } catch (PDOException $e) {}
        try { $pdo->exec("PRAGMA foreign_keys = ON"); } catch (PDOException $e) {}

        self::$pdo = $pdo;
        return $pdo;
    }

    public static function query(string $sql, array $params = [])
    {
        $stmt = self::conn()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $stmt = self::query($sql, $params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public static function all(string $sql, array $params = []): array
    {
        $stmt = self::query($sql, $params);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public static function exec(string $sql, array $params = []): int
    {
        $stmt = self::conn()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    public static function lastInsertId(): int
    {
        return (int) self::conn()->lastInsertId();
    }
}