<?php
use App\Services\DB;

$autoload = __DIR__ . '/../vendor/autoload.php';
if (is_file($autoload)) {
    require $autoload;
    if (class_exists(\Dotenv\Dotenv::class)) {
        $dotenv = \Dotenv\Dotenv::createImmutable(__DIR__ . '/..');
        $dotenv->safeLoad();
    }
} else {
    // Composer autoload not found; continue without external libraries (Dotenv, etc.)
    // Minimal PSR-4 autoloader for the App\\ namespace so internal classes still work.
    spl_autoload_register(function (string $class): void {
        if (str_starts_with($class, 'App\\')) {
            $relative = str_replace('App\\', '', $class);
            $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
            if (is_file($path)) {
                require $path;
            }
        }
    });

    // Fallback: load environment variables from .env files if present
    (function (): void {
        // Search order: php-backend/.env, project-root/.env, php-backend/.env.example
        $candidates = [
            __DIR__ . '/../.env',
            dirname(__DIR__, 2) . '/.env',
            __DIR__ . '/../.env.example',
        ];

        foreach ($candidates as $envFile) {
            if (!is_file($envFile)) continue;

            $lines = @file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            if (!$lines) continue;

            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') continue;

                // Allow 'export KEY=val' syntax
                if (str_starts_with($line, 'export ')) {
                    $line = trim(substr($line, strlen('export ')));
                }

                $eq = strpos($line, '=');
                if ($eq === false) continue;

                $key = trim(substr($line, 0, $eq));
                $val = trim(substr($line, $eq + 1));

                // Strip surrounding quotes
                if ($val !== '') {
                    $first = $val[0];
                    $last = $val[strlen($val) - 1] ?? '';
                    if (($first === '\"' && $last === '\"') || ($first === "'" && $last === "'")) {
                        $val = substr($val, 1, -1);
                    }
                }

                // Basic variable expansion: ${KEY} -> existing env
                $val = preg_replace_callback('/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/', function ($m) {
                    $k = $m[1];
                    $v = getenv($k);
                    return $v !== false ? $v : '';
                }, $val);

                // Only set if not already set to avoid overwriting explicitly provided env
                $existing = getenv($key);
                if ($existing === false || $existing === '') {
                    putenv("{$key}={$val}");
                    $_ENV[$key] = $val;
                }
            }
        }
    })();
}

date_default_timezone_set('UTC');

// Trust proxy hops (used by IP helper)
function client_ip(): string {
    $trust = (int) (getenv('TRUST_PROXY_HOPS') ?: 1);
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($trust > 0 && $xff) {
        $parts = array_map('trim', explode(',', $xff));
        if (count($parts)) {
            return preg_replace('/^::ffff:/', '', $parts[0]);
        }
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    return $ip ? preg_replace('/^::ffff:/', '', $ip) : '';
}

function json_response($data, int $status = 200): void {
    header('Content-Type: application/json');
    http_response_code($status);
    echo json_encode($data);
}

function text_response(string $text, int $status = 200, string $ctype = 'text/plain'): void {
    header("Content-Type: {$ctype}");
    http_response_code($status);
    echo $text;
}

function xml_response(string $xml, int $status = 200): void {
    header('Content-Type: application/xml');
    http_response_code($status);
    echo $xml;
}

function read_body_json(): array {
    $raw = file_get_contents('php://input');
    $obj = json_decode($raw, true);
    return is_array($obj) ? $obj : [];
}

function cookie_value(string $name): ?string {
    if (isset($_COOKIE[$name])) return $_COOKIE[$name];
    $hdr = $_SERVER['HTTP_COOKIE'] ?? '';
    foreach (explode(';', $hdr) as $part) {
        $kv = explode('=', trim($part), 2);
        if (count($kv) === 2) {
            if ($kv[0] === $name) return urldecode($kv[1]);
        }
    }
    return null;
}

function set_auth_cookie(string $token): void {
    $isProd = (getenv('APP_ENV') ?: '') === 'production';
    $domainUrl = getenv('PUBLIC_ORIGIN') ?: (getenv('PUBLIC_DOMAIN') ?: '');
    $cookieDomain = '';
    if ($domainUrl) {
        try {
            $cookieDomain = parse_url($domainUrl, PHP_URL_HOST) ?: '';
        } catch (\Throwable $e) {}
    }
    // Compute valid cookie domain attribute:
    // Only set domain when it contains a dot and is not an IP. For localhost/IP, omit domain (host-only cookie).
    $domainAttr = '';
    if ($cookieDomain) {
        $isIp = filter_var($cookieDomain, FILTER_VALIDATE_IP) !== false;
        $hasDot = strpos($cookieDomain, '.') !== false;
        if (!$isIp && $hasDot) {
            $domainAttr = $cookieDomain;
        }
    }
    $params = [
        'expires' => time() + 7 * 24 * 60 * 60,
        'path' => '/',
        'domain' => $domainAttr,
        'secure' => $isProd ? true : false,
        'httponly' => true,
        'samesite' => 'None'
    ];
    // PHP setcookie signature handling
    setcookie('auth_token', $token, $params);
}

// Basic CORS (parity with Node defaults)
function cors_allow(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = false;
    $whitelist = array_filter(array_map('trim', explode(',', getenv('CORS_ORIGINS') ?: '')));
    if (!$origin) {
        $allowed = true;
    } else {
        if (in_array($origin, $whitelist, true)) $allowed = true;
        $pub = getenv('PUBLIC_ORIGIN') ?: (getenv('PUBLIC_DOMAIN') ?: 'https://ganudenu.store');
        $pubHost = '';
        try { $pubHost = parse_url($pub, PHP_URL_HOST) ?: ''; } catch (\Throwable $e) {}
        $host = '';
        try { $host = parse_url($origin, PHP_URL_HOST) ?: ''; } catch (\Throwable $e) {}
        // Always allow our production domains
        if ($host === 'ganudenu.store' || str_ends_with($host, '.ganudenu.store')) $allowed = true;
        if ($pubHost && $host === $pubHost) $allowed = true;
        // Dev convenience: allow localhost and 127.0.0.1 origins
        if ($host === 'localhost' || $host === '127.0.0.1') $allowed = true;
    }
    if ($allowed) {
        header('Access-Control-Allow-Origin: ' . ($origin ?: '*'));
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Email, X-User-Email');
        header('Access-Control-Max-Age: 600');
    }
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// Initialize base tables similar to Node's startup
function init_base_schema(): void {
    $pdo = DB::conn();

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    ");

    // Ensure columns
    $cols = DB::all("PRAGMA table_info(users)");
    $names = array_map(fn($c) => $c['name'], $cols);
    if (!in_array('username', $names)) $pdo->exec("ALTER TABLE users ADD COLUMN username TEXT");
    $idxExists = DB::one("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_username_unique'");
    if (!$idxExists) $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username)");
    if (!in_array('profile_photo_path', $names)) $pdo->exec("ALTER TABLE users ADD COLUMN profile_photo_path TEXT");
    if (!in_array('is_banned', $names)) $pdo->exec("ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0");
    if (!in_array('suspended_until', $names)) $pdo->exec("ALTER TABLE users ADD COLUMN suspended_until TEXT");
    if (!in_array('user_uid', $names)) {
        $pdo->exec("ALTER TABLE users ADD COLUMN user_uid TEXT");
        $pdo->exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_uid_unique ON users(user_uid)");
    }
    if (!in_array('is_verified', $names)) $pdo->exec("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        gemini_api_key TEXT,
        bank_details TEXT,
        whatsapp_number TEXT
      )
    ");
    $cols = DB::all("PRAGMA table_info(admin_config)");
    $names = array_map(fn($c) => $c['name'], $cols);
    if (!in_array('email_on_approve', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN email_on_approve INTEGER NOT NULL DEFAULT 0");
    if (!in_array('maintenance_mode', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0");
    if (!in_array('maintenance_message', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN maintenance_message TEXT");
    if (!in_array('bank_account_number', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN bank_account_number TEXT");
    if (!in_array('bank_account_name', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN bank_account_name TEXT");
    if (!in_array('bank_name', $names)) $pdo->exec("ALTER TABLE admin_config ADD COLUMN bank_name TEXT");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS payment_rules (
        category TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1
      )
    ");

    // Seed payment defaults
    $exists = DB::one("SELECT COUNT(*) as c FROM payment_rules");
    if (!$exists || (int)($exists['c'] ?? 0) === 0) {
        $ins = $pdo->prepare("INSERT INTO payment_rules (category, amount, enabled) VALUES (?, ?, ?)");
        foreach ([['Vehicle',300],['Property',500],['Job',200],['Electronic',200],['Mobile',0],['Home Garden',200],['Other',200]] as $row) {
            $ins->execute([$row[0], $row[1], 1]);
        }
    }

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL
      )
    ");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        otp TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )
    ");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS banners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    ");

    // New: notifications + reads + saved_searches (parity with Node)
    $pdo->exec("
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        target_email TEXT,
        created_at TEXT NOT NULL,
        type TEXT DEFAULT 'general',
        listing_id INTEGER,
        meta_json TEXT,
        emailed_at TEXT
      )
    ");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_email)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notifications_listing ON notifications(listing_id)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notifications_emailed ON notifications(emailed_at)");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS notification_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER NOT NULL,
        user_email TEXT NOT NULL,
        read_at TEXT NOT NULL,
        UNIQUE(notification_id, user_email)
      )
    ");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notif_reads_user ON notification_reads(user_email)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_notif_reads_notif ON notification_reads(notification_id)");

    $pdo->exec("
      CREATE TABLE IF NOT EXISTS saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        name TEXT,
        category TEXT,
        location TEXT,
        price_min REAL,
        price_max REAL,
        filters_json TEXT,
        created_at TEXT NOT NULL
      )
    ");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_email)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_saved_searches_cat ON saved_searches(category)");
    $pdo->exec("CREATE INDEX IF NOT EXISTS idx_saved_searches_loc ON saved_searches(location)");

    // Ensure single admin_config row
    $cfg = DB::one("SELECT id FROM admin_config WHERE id = 1");
    if (!$cfg) {
        DB::exec("INSERT INTO admin_config (id, gemini_api_key) VALUES (1, NULL)");
    }

    // Admin seed if provided
    $adminEmail = strtolower(getenv('ADMIN_EMAIL') ?: 'janithmanodaya2002@gmail.com');
    $adminPass = getenv('ADMIN_PASSWORD') ?: '';
    if ($adminPass) {
        $u = DB::one("SELECT id FROM users WHERE email = ?", [$adminEmail]);
        $hash = password_hash($adminPass, PASSWORD_BCRYPT);
        if ($u) {
            DB::exec("UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?", [$hash, (int)$u['id']]);
        } else {
            DB::exec("INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)", [$adminEmail, $hash, gmdate('c')]);
        }
    }
}

// Ensure DB class is available even if autoload did not trigger yet
if (!class_exists(\App\Services\DB::class)) {
    require __DIR__ . '/Services/DB.php';
}

init_base_schema();