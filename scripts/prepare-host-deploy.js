/**
 * Prepare a host-friendly deploy folder for ganudenu.store.
 * - Runs npm install and npm run build (creates dist/)
 * - Creates host-deploy/ with:
 *    - Frontend build (index.html + assets from dist/)
 *    - .htaccess to route /api and /uploads to PHP backend, and SPA fallback
 *    - api/ PHP backend (index.php + app/ + config/ + composer files + optional vendor/)
 *    - api/.htaccess with hardening (deny sensitive files, force front controller)
 *    - api/.env with production-safe defaults (DB_PATH, UPLOADS_PATH, PUBLIC_DOMAIN, etc.)
 *    - api/var/ (writable folders) and api/var/uploads/
 *
 * After this finishes, upload host-deploy/ contents into your hosting public_html.
 * No server-side commands are required on the host.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'host-deploy');

// Allow overriding backend output folder name (default 'api') via env
let BACKEND_DIR = (process.env.BACKEND_DIR || 'api').replace(/^[\\/]+|[\\/]+$/g, '');
if (!BACKEND_DIR) BACKEND_DIR = 'api';

// Public API route path (what the frontend calls). Default '/api'
let PUBLIC_API_ROUTE = process.env.PUBLIC_API_ROUTE || '/api';
if (!PUBLIC_API_ROUTE.startsWith('/')) PUBLIC_API_ROUTE = `/${PUBLIC_API_ROUTE}`;

const API_OUT = path.join(OUT, BACKEND_DIR);
const API_VAR = path.join(API_OUT, 'var');
const API_UPLOADS = path.join(API_VAR, 'uploads');
const PHP_BACKEND = path.join(ROOT, 'php-backend');

function log(msg) {
  console.log(`[deploy] ${msg}`);
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst, options = {}) {
  const {
    filter = () => true,
  } = options;
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isFile()) {
    if (filter(src)) copyFile(src, dst);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const istat = fs.statSync(s);
    if (istat.isDirectory()) {
      copyDir(s, d, options);
    } else {
      if (filter(s)) copyFile(s, d);
    }
  }
}

function run(cmd) {
  log(`Running: ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

function ensureBuilt() {
  // Install and build
  run('npm install');
  run('npm run build');
  if (!fs.existsSync(DIST)) {
    throw new Error('Build did not produce dist/ folder');
  }
}

function writeRootHtaccess() {
  const backendTarget = `${BACKEND_DIR}/index.php`;
  const apiRoute = PUBLIC_API_ROUTE; // already normalized to start with '/'

  const ht = `
RewriteEngine On

# Basic security headers
<IfModule mod_headers.c>
Header set X-Frame-Options "SAMEORIGIN"
Header set X-Content-Type-Options "nosniff"
Header set Referrer-Policy "no-referrer-when-downgrade"
Header set Permissions-Policy "geolocation=(), microphone=(), camera=()"
</IfModule>

# Route API and uploads requests to PHP backend
RewriteCond %{REQUEST_URI} ^${apiRoute} [NC]
RewriteRule ^ ${backendTarget} [L]

RewriteCond %{REQUEST_URI} ^/uploads [NC]
RewriteRule ^ ${backendTarget} [L]

# Serve existing files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# SPA fallback to built index.html
RewriteRule . index.html [L]
`.trim() + '\n';
  fs.writeFileSync(path.join(OUT, '.htaccess'), ht, 'utf8');
}

function writeApiHtaccess() {
  const ht = `
# Security hardening for API directory
Options -Indexes
RewriteEngine On

# Force front-controller for non-existing files/dirs
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.php [L]

# Deny access to sensitive files
<FilesMatch "(?i)\\.(env|lock|phar|ya?ml|sql|sqlite|sqlite3|md|log)$">
  Require all denied
</FilesMatch>

# Disallow direct access to PHP files other than index.php
<FilesMatch "(?i)^(?!index\\.php$).+\\.php$">
  Require all denied
</FilesMatch>

# Block access to internal directories
RewriteRule ^(app|config|database|tests|reports|nginx|scripts|vendor)(/|$) - [F,L]

# Security headers
<IfModule mod_headers.c>
Header set X-Frame-Options "SAMEORIGIN"
Header set X-Content-Type-Options "nosniff"
Header set Referrer-Policy "no-referrer-when-downgrade"
Header set Permissions-Policy "geolocation=(), microphone=(), camera=()"
</IfModule>
`.trim() + '\n';
  fs.writeFileSync(path.join(API_OUT, '.htaccess'), ht, 'utf8');
}

function createOutStructure() {
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(API_OUT, { recursive: true });
  fs.mkdirSync(API_VAR, { recursive: true });
  fs.mkdirSync(API_UPLOADS, { recursive: true });
}

function copyFrontend() {
  // Copy built site to OUT root
  copyDir(DIST, OUT);
}

function copyPhpBackend() {
  // index.php
  copyFile(path.join(PHP_BACKEND, 'public', 'index.php'), path.join(API_OUT, 'index.php'));
  // app/
  copyDir(path.join(PHP_BACKEND, 'app'), path.join(API_OUT, 'app'));
  // config/
  copyDir(path.join(PHP_BACKEND, 'config'), path.join(API_OUT, 'config'));
  // database/ (if any schema files)
  copyDir(path.join(PHP_BACKEND, 'database'), path.join(API_OUT, 'database'));
  // Optional vendor/
  if (fs.existsSync(path.join(PHP_BACKEND, 'vendor'))) {
    copyDir(path.join(PHP_BACKEND, 'vendor'), path.join(API_OUT, 'vendor'));
  }
  // Composer files (optional; backend works without vendor)
  for (const f of ['composer.json', 'composer.lock', 'composer.phar', '.env.example', 'openapi.yaml']) {
    const src = path.join(PHP_BACKEND, f);
    if (fs.existsSync(src)) copyFile(src, path.join(API_OUT, f));
  }
}

function writeApiEnv() {
  // To avoid phpdotenv escape parsing on Windows backslashes, always write forward slashes
  // and use single quotes (phpdotenv treats single-quoted values literally).
  const toPosix = (p) => p.replace(/\\\\/g, '/');
  const DB_PATH = toPosix(path.join(API_VAR, 'ganudenu.sqlite'));
  const UPLOADS = toPosix(API_UPLOADS);
  const ORIGIN = 'https://ganudenu.store';
  const lines = [
    `APP_ENV='production'`,
    `PUBLIC_DOMAIN='${ORIGIN}'`,
    `PUBLIC_ORIGIN='${ORIGIN}'`,
    `TRUST_PROXY_HOPS='1'`,
    `DB_PATH='${DB_PATH}'`,
    `UPLOADS_PATH='${UPLOADS}'`,
    `CORS_ORIGINS='${ORIGIN}'`,
    // Email: default to dev mode on shared hosts so OTP flows don't 502 when SMTP is not configured.
    // Set EMAIL_DEV_MODE='false' and configure SMTP_* or BREVO_* for production email sending.
    `EMAIL_DEV_MODE='true'`,
    `SMTP_FROM='no-reply@${new URL(ORIGIN).hostname}'`,
    // Admin email default is already handled in code; set if you want:
    // `ADMIN_EMAIL='janithmanodaya2002@gmail.com'`,
    // `ADMIN_PASSWORD='change_me'`,
  ];
  const envPath = path.join(API_OUT, '.env');
  try { fs.unlinkSync(envPath); } catch {}
  fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
  log(`Wrote ${envPath} with DB_PATH=${DB_PATH} and UPLOADS_PATH=${UPLOADS}`);
}

function fixApiIndexRequire() {
  const idx = path.join(API_OUT, 'index.php');
  if (!fs.existsSync(idx)) return;
  let src = fs.readFileSync(idx, 'utf8');
  // Adjust require path from ../app/bootstrap.php (original path under public/)
  // to ./app/bootstrap.php (since app/ is inside backend dir)
  const before = "/../app/bootstrap.php";
  const after = "/app/bootstrap.php";
  if (src.includes(before)) {
    src = src.replace(before, after);
    fs.writeFileSync(idx, src, 'utf8');
    log(`Patched ${BACKEND_DIR}/index.php require path to /app/bootstrap.php`);
  }
}

function main() {
  log('Preparing host-friendly deploy for ganudenu.store');
  log(`Using backend output folder: ${BACKEND_DIR} (PUBLIC_API_ROUTE=${PUBLIC_API_ROUTE})`);
  ensureBuilt();
  createOutStructure();
  copyFrontend();
  writeRootHtaccess();
  copyPhpBackend();
  writeApiHtaccess();
  fixApiIndexRequire();
  writeApiEnv();

  log('Done. Upload the contents of host-deploy/ to your hosting public_html.');
  log(`On the host, ensure ${BACKEND_DIR}/var and ${BACKEND_DIR}/var/uploads are writable by the web server (usually 775 or 755).`);
}

main();