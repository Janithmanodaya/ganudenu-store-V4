<?php
namespace App\Controllers;

use App\Services\DB;
use App\Services\JWT;
use App\Services\SSE;

class ChatsController
{
    private static function requireUser(): ?array
    {
        $tok = JWT::getBearerToken();
        if ($tok) {
            $v = JWT::verify($tok);
            if (!$v['ok']) { \json_response(['error' => 'Invalid token'], 401); return null; }
            $claims = $v['decoded'];
            $row = DB::one("SELECT id, email, is_banned, suspended_until FROM users WHERE id = ?", [(int)$claims['user_id']]);
            if (!$row || strtolower($row['email']) !== strtolower($claims['email'])) { \json_response(['error' => 'Invalid user'], 401); return null; }
            if (!empty($row['is_banned'])) { \json_response(['error' => 'Account banned'], 403); return null; }
            if (!empty($row['suspended_until']) && strtotime($row['suspended_until']) > time()) { \json_response(['error' => 'Account suspended'], 403); return null; }
            return ['id' => (int)$row['id'], 'email' => strtolower($row['email'])];
        }

        // Fallback: header-based auth for legacy clients
        $email = strtolower(trim((string)($_SERVER['HTTP_X_USER_EMAIL'] ?? '')));
        if ($email === '') { \json_response(['error' => 'Missing Authorization bearer token or X-User-Email header'], 401); return null; }

        $row = DB::one("SELECT id, email, is_banned, suspended_until FROM users WHERE LOWER(email) = LOWER(?)", [$email]);
        if (!$row) {
            // Best-effort: create non-admin user record to enable chat for header-auth clients
            try {
                DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at, is_verified) VALUES (?, ?, 0, ?, 0)", [
                    $email,
                    password_hash(bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
                    gmdate('c')
                ]);
                $row = DB::one("SELECT id, email, is_banned, suspended_until FROM users WHERE email = ?", [$email]);
            } catch (\Throwable $e) {
                \json_response(['error' => 'Invalid user'], 401);
                return null;
            }
        }
        if (!empty($row['is_banned'])) { \json_response(['error' => 'Account banned'], 403); return null; }
        if (!empty($row['suspended_until']) && strtotime($row['suspended_until']) > time()) { \json_response(['error' => 'Account suspended'], 403); return null; }
        return ['id' => (int)$row['id'], 'email' => strtolower((string)$row['email'])];
    }

    private static function requireAdmin(): ?array
    {
        $tok = JWT::getBearerToken();
        if (!$tok) { \json_response(['error' => 'Missing Authorization bearer token'], 401); return null; }
        $v = JWT::verify($tok);
        if (!$v['ok']) { \json_response(['error' => 'Invalid token'], 401); return null; }
        $claims = $v['decoded'];
        $row = DB::one("SELECT id, email, is_admin FROM users WHERE id = ?", [(int)$claims['user_id']]);
        if (!$row || !(int)$row['is_admin']) { \json_response(['error' => 'Forbidden'], 403); return null; }
        if (strtolower($row['email']) !== strtolower($claims['email'])) { \json_response(['error' => 'Invalid user'], 401); return null; }
        return ['id' => (int)$row['id'], 'email' => strtolower($row['email'])];
    }

    private static function ensureSchema(): void
    {
        DB::exec("
          CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            sender TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        ");
    }

    public static function list(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $cutoff = gmdate('c', time() - 7 * 24 * 3600);
        $rows = DB::all("
          SELECT id, sender, message, created_at
          FROM chats
          WHERE user_email = ? AND created_at >= ?
          ORDER BY id ASC
          LIMIT 500
        ", [$u['email'], $cutoff]);
        \json_response(['results' => $rows]);
    }

    public static function send(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;
        $b = \read_body_json();
        $message = trim((string)($b['message'] ?? ''));
        if (!$message) { \json_response(['error' => 'Message required.'], 400); return; }
        $ts = gmdate('c');
        DB::exec("INSERT INTO chats (user_email, sender, message, created_at) VALUES (?, 'user', ?, ?)", [$u['email'], mb_substr($message, 0, 2000), $ts]);

        // Notify admins (in-app notifications)
        try {
            $admins = DB::all("SELECT email FROM users WHERE is_admin = 1");
            $ins = DB::conn()->prepare("
              INSERT INTO notifications (title, message, target_email, created_at, type)
              VALUES (?, ?, ?, ?, 'chat')
            ");
            $preview = strlen($message) > 160 ? (substr($message, 0, 157) . '...') : $message;
            foreach ($admins as $a) {
                $target = strtolower(trim((string)$a['email']));
                if (!$target) continue;
                $ins->execute(['New Chat Message', 'User ' . $u['email'] . ' sent: ' . $preview, $target, $ts]);
            }
        } catch (\Throwable $e) {}

        \json_response(['ok' => true, 'created_at' => $ts]);
    }

    public static function adminConversations(): void
    {
        self::ensureSchema();
        $admin = self::requireAdmin(); if (!$admin) return;
        $cutoff = gmdate('c', time() - 7 * 24 * 3600);
        $rows = DB::all("
          SELECT user_email, MAX(id) AS last_id, MAX(created_at) AS last_ts
          FROM chats
          WHERE created_at >= ?
          GROUP BY user_email
          ORDER BY last_ts DESC
          LIMIT 500
        ", [$cutoff]);
        $getMsg = DB::conn()->prepare("SELECT message, sender, created_at FROM chats WHERE id = ?");
        $results = [];
        foreach ($rows as $r) {
            $getMsg->execute([(int)$r['last_id']]);
            $last = $getMsg->fetch(\PDO::FETCH_ASSOC) ?: [];
            $results[] = [
                'user_email' => $r['user_email'],
                'last_message' => $last['message'] ?? '',
                'last_sender' => $last['sender'] ?? '',
                'last_ts' => $last['created_at'] ?? ($r['last_ts'] ?? '')
            ];
        }
        \json_response(['results' => $results]);
    }

    public static function adminFetch(array $params): void
    {
        self::ensureSchema();
        $admin = self::requireAdmin(); if (!$admin) return;
        $email = strtolower(trim((string)($params['email'] ?? '')));
        if (!$email) { \json_response(['error' => 'Invalid email.'], 400); return; }
        $cutoff = gmdate('c', time() - 7 * 24 * 3600);
        $rows = DB::all("
          SELECT id, sender, message, created_at
          FROM chats
          WHERE user_email = ? AND created_at >= ?
          ORDER BY id ASC
          LIMIT 1000
        ", [$email, $cutoff]);
        \json_response(['results' => $rows]);
    }

    public static function adminSend(array $params): void
    {
        self::ensureSchema();
        $admin = self::requireAdmin(); if (!$admin) return;
        $email = strtolower(trim((string)($params['email'] ?? '')));
        $b = \read_body_json();
        $message = trim((string)($b['message'] ?? ''));
        if (!$email) { \json_response(['error' => 'Invalid email.'], 400); return; }
        if (!$message) { \json_response(['error' => 'Message required.'], 400); return; }
        $ts = gmdate('c');
        DB::exec("INSERT INTO chats (user_email, sender, message, created_at) VALUES (?, 'admin', ?, ?)", [$email, mb_substr($message, 0, 2000), $ts]);
        \json_response(['ok' => true, 'created_at' => $ts]);
    }

    public static function userStream(): void
    {
        self::ensureSchema();
        $u = self::requireUser(); if (!$u) return;

        @set_time_limit(0);
        SSE::start();

        $email = $u['email'];
        $cutoffIso = gmdate('c', time() - 7 * 24 * 3600);
        $lastIdParam = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

        $getNew = function (int $sinceId) use ($email, $cutoffIso) {
            return DB::all("
                SELECT id, sender, message, created_at
                FROM chats
                WHERE user_email = ? AND id > ? AND created_at >= ?
                ORDER BY id ASC
                LIMIT 200
            ", [$email, $sinceId, $cutoffIso]);
        };

        // Initialize lastId to current max to avoid resending history unless client requests via last_id
        $rowMax = DB::one("SELECT MAX(id) AS max_id FROM chats WHERE user_email = ?", [$email]);
        $lastId = (int)($rowMax['max_id'] ?? 0);

        if ($lastIdParam > 0) {
            $rows = $getNew($lastIdParam);
            if (count($rows)) {
                SSE::event('chat_messages', ['results' => $rows]);
                $lastId = (int)$rows[count($rows) - 1]['id'];
            } else {
                $lastId = max($lastId, $lastIdParam);
            }
        }

        $intervalMs = 30000;
        $lastEvent = microtime(true);
        $lastHb = microtime(true);
        $endAt = microtime(true) + 25.0;

        while (!connection_aborted() && microtime(true) < $endAt) {
            $now = microtime(true);
            if (($now - $lastEvent) * 1000 >= $intervalMs) {
                $rows = $getNew($lastId);
                if (count($rows)) {
                    SSE::event('chat_messages', ['results' => $rows]);
                    $lastId = (int)$rows[count($rows) - 1]['id'];
                }
                $lastEvent = $now;
            }
            if (($now - $lastHb) >= 15) {
                SSE::heartbeat();
                $lastHb = $now;
            }
            usleep(250000);
        }
        echo ": closing\n\n";
        flush();
        exit;
    }

    public static function adminStream(array $params): void
    {
        self::ensureSchema();
        $admin = self::requireAdmin(); if (!$admin) return;

        $email = strtolower(trim((string)($params['email'] ?? '')));
        if (!$email) { \text_response(json_encode(['error' => 'Invalid email.']), 400, 'application/json'); return; }

        @set_time_limit(0);
        SSE::start();

        $cutoffIso = gmdate('c', time() - 7 * 24 * 3600);
        $lastIdParam = isset($_GET['last_id']) ? (int)$_GET['last_id'] : 0;

        $getNew = function (int $sinceId) use ($email, $cutoffIso) {
            return DB::all("
                SELECT id, sender, message, created_at
                FROM chats
                WHERE user_email = ? AND id > ? AND created_at >= ?
                ORDER BY id ASC
                LIMIT 300
            ", [$email, $sinceId, $cutoffIso]);
        };

        $rowMax = DB::one("SELECT MAX(id) AS max_id FROM chats WHERE user_email = ?", [$email]);
        $lastId = (int)($rowMax['max_id'] ?? 0);

        if ($lastIdParam > 0) {
            $rows = $getNew($lastIdParam);
            if (count($rows)) {
                SSE::event('chat_messages', ['results' => $rows]);
                $lastId = (int)$rows[count($rows) - 1]['id'];
            } else {
                $lastId = max($lastId, $lastIdParam);
            }
        }

        $intervalMs = 30000;
        $lastEvent = microtime(true);
        $lastHb = microtime(true);
        $endAt = microtime(true) + 25.0;

        while (!connection_aborted() && microtime(true) < $endAt) {
            $now = microtime(true);
            if (($now - $lastEvent) * 1000 >= $intervalMs) {
                $rows = $getNew($lastId);
                if (count($rows)) {
                    SSE::event('chat_messages', ['results' => $rows]);
                    $lastId = (int)$rows[count($rows) - 1]['id'];
                }
                $lastEvent = $now;
            }
            if (($now - $lastHb) >= 15) {
                SSE::heartbeat();
                $lastHb = $now;
            }
            usleep(250000);
        }
        echo ": closing\n\n";
        flush();
        exit;
    }
}