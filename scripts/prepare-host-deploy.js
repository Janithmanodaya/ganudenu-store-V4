/**
 * Prepare a host-friendly deploy folder for ganudenu.store.
 * - Runs npm install and npm run build (creates dist/)
 * - Creates host-deploy/ with:
 *    - Frontend build (index.html + assets from dist/)
 *    - .htaccess to route /api and /uploads to PHP backend, and SPA fallback
 *    - api/ PHP backend (index.php + app/ + config/ + composer files + optional vendor/)
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
const API_OUT = path.join(OUT, 'api');
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
  const ht = `
RewriteEngine On

# Route API and uploads requests to PHP backend
RewriteCond %{REQUEST_URI} ^/api [NC]
RewriteRule ^ api/index.php [L]

RewriteCond %{REQUEST_URI} ^/uploads [NC]
RewriteRule ^ api/index.php [L]

# Serve existing files directly
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# SPA fallback to built index.html
RewriteRule . index.html [L]
`.trim() + '\n';
  fs.writeFileSync(path.join(OUT, '.htaccess'), ht, 'utf8');
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
  const env = [
    'APP_ENV=production',
    'PUBLIC_DOMAIN=https://ganudenu.store',
    'PUBLIC_ORIGIN=https://ganudenu.store',
    'TRUST_PROXY_HOPS=1',
    // Place DB under api/var to avoid exposing it at web root
    `DB_PATH=${path.join(API_VAR, 'ganudenu.sqlite').replace(/\\\\/g, '/')}`,
    `UPLOADS_PATH=${API_UPLOADS.replace(/\\\\/g, '/')}`,
    'CORS_ORIGINS=https://ganudenu.store',
    // Admin email default is already handled in code; set if you want:
    // 'ADMIN_EMAIL=janithmanodaya2002@gmail.com',
    // 'ADMIN_PASSWORD=change_me',
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(API_OUT, '.env'), env, 'utf8');
}

function main() {
  log('Preparing host-friendly deploy for ganudenu.store');
  ensureBuilt();
  createOutStructure();
  copyFrontend();
  writeRootHtaccess();
  copyPhpBackend();
  writeApiEnv();

  log('Done. Upload the contents of host-deploy/ to your hosting public_html.');
  log('On the host, ensure api/var and api/var/uploads are writable by the web server (usually 775 or 755).');
}

main();