/**
 * Express application (exported for tests and server entry)
 */
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import { db } from './lib/db.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import listingsRouter from './routes/listings.js';
import jobsRouter from './routes/jobs.js';
import notificationsRouter from './routes/notifications.js';
import chatsRouter from './routes/chats.js';
import usersRouter from './routes/users.js';
import wantedRouter from './routes/wanted.js';
import { sendEmail } from './lib/utils.js';
import helmet from 'helmet';
import compression from 'compression';
import { verifyTokenRaw } from './lib/auth.js';

dotenv.config();

const app = express();

// Compatibility: if Google Console or old configs point to /auth/google/*,
// forward them to our API routes under /api/auth/google/* preserving query string
app.get('/auth/google/start', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/api/auth/google/start' + qs);
});
app.get('/auth/google/callback', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, '/api/auth/google/callback' + qs);
});

// --- Maintenance mode helpers ---
function getMaintenanceConfig() {
  try {
    const row = db.prepare('SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1').get();
    return {
      enabled: !!(row && row.maintenance_mode),
      message: row?.maintenance_message || ''
    };
  } catch (_) {
    return { enabled: false, message: '' };
  }
}

// Render maintenance HTML (prefer src/maintenance.html; fallback to default)
// Note: We avoid using data/ because it may be reset on server restarts.
function renderMaintenancePage() {
  // Try src/maintenance.html first
  try {
    const srcPath = path.resolve(process.cwd(), 'src', 'maintenance.html');
    if (fs.existsSync(srcPath)) {
      return fs.readFileSync(srcPath, 'utf8');
    }
  } catch (_) {}
  // Legacy fallback (if someone left a copy in data/)
  try {
    const dataPath = path.resolve(process.cwd(), 'data', 'maintenance.html');
    if (fs.existsSync(dataPath)) {
      return fs.readFileSync(dataPath, 'utf8');
    }
  } catch (_) {}
  const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Maintenance - Ganudenu</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#0b1220;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center}
    .card{max-width:720px;padding:32px 28px;border-radius:16px;background:linear-gradient(180deg,#121a2e,#0b1220);box-shadow:0 10px 30px rgba(0,0,0,.35)}
    h1{margin:0 0 8px;font-size:28px;letter-spacing:.3px}
    p{margin:6px 0 0;color:#ccd3e2;line-height:1.6}
    .small{margin-top:16px;font-size:12px;color:#9fb0cf}
    a{color:#58a6ff;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <h1>We’re performing maintenance</h1>
    <p>Ganudenu is temporarily unavailable while we upgrade our systems. Please check back in a little while.</p>
    <p class="small">If you are an administrator, you can manage maintenance from the <a href="${domain}/admin">Admin Panel</a>.</p>
  </div>
</body>
</html>`;
}

// Trust proxy: configurable hops
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

// Security headers and compression
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' }
  }));
  app.use(compression());
} else {
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
}

// Strict CORS whitelist with sensible defaults for ganudenu.store subdomains
const corsWhitelist = (() => {
  const envList = String(process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '').trim();
  if (!envList) return [];
  return envList.split(',').map(s => s.trim()).filter(Boolean);
})();

function isOriginAllowed(origin) {
  try {
    if (!origin) return true; // allow same-origin, curl, etc.
    const o = String(origin).trim();
    if (corsWhitelist.includes(o)) return true;

    // Allow configured PUBLIC_ORIGIN/PUBLIC_DOMAIN host implicitly
    const pub = String(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_DOMAIN || 'https://ganudenu.store').trim();
    const pubHost = (() => { try { return new URL(pub).hostname } catch (_) { return '' } })();
    const host = new URL(o).hostname;

    // Permit ganudenu.store and its subdomains (e.g., test.ganudenu.store) by default
    if (host === 'ganudenu.store' || host.endsWith('.ganudenu.store')) return true;

    // Also allow exact PUBLIC_ORIGIN/PUBLIC_DOMAIN host if provided
    if (pubHost && host === pubHost) return true;

    return false;
  } catch (_) {
    return false;
  }
}

app.use(cors({
  origin: function (origin, callback) {
    if (isOriginAllowed(origin)) return callback(null, true);
    return callback(new Error('CORS not allowed for origin: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Email', 'X-User-Email'],
  maxAge: 600
}));

app.use(express.json());

// Logging
function sanitizeUrlForLogs(req) {
  try {
    const original = String(req.originalUrl || req.url || '');
    // Only redact sensitive params on specific OAuth routes
    const p = String(req.path || original.split('?')[0] || '').toLowerCase();

    // Helper: remove specific query params
    function redactParams(u, keys) {
      try {
        const base = original.startsWith('http') ? new URL(original) : new URL('http://local' + original);
        for (const k of keys) {
          if (base.searchParams.has(k)) {
            base.searchParams.set(k, 'REDACTED');
          }
        }
        // Return path + sanitized query
        const pathname = base.pathname;
        const qp = base.searchParams.toString();
        return qp ? `${pathname}?${qp}` : pathname;
      } catch (_) {
        return original.split('?')[0]; // fallback: strip query
      }
    }

    if (p === '/api/auth/google/callback') {
      // Redact code, state, scope from logs
      return redactParams(original, ['code', 'state', 'scope']);
    }
    if (p === '/api/auth/google/start') {
      // Redact state param (and return URL)
      return redactParams(original, ['state', 'r']);
    }

    // Default: leave as-is
    return original;
  } catch (_) {
    return req.originalUrl || req.url || '';
  }
}

if (process.env.NODE_ENV === 'production') {
  app.use(morgan((tokens, req, res) => JSON.stringify({
    method: tokens.method(req, res),
    url: sanitizeUrlForLogs(req),
    status: Number(tokens.status(req, res)),
    length: tokens.res(req, res, 'content-length'),
    response_time_ms: Number(tokens['response-time'](req, res)),
    ts: new Date().toISOString()
  })));
} else {
  // In dev, use concise output but still sanitize sensitive URLs
  app.use(morgan((tokens, req, res) => {
    const method = tokens.method(req, res);
    const url = sanitizeUrlForLogs(req);
    const status = tokens.status(req, res);
    const rt = tokens['response-time'](req, res);
    const len = tokens.res(req, res, 'content-length') || '-';
    return `${method} ${url} ${status} ${rt} ms - ${len}`;
  }));
}

// Static uploads
app.use('/uploads', express.static(path.resolve(process.cwd(), 'data', 'uploads'), {
  maxAge: '365d',
  immutable: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Global rate limit
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// DB setup (same as original index.js)
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`).run();

// Ensure columns
try {
  const cols = db.prepare(`PRAGMA table_info(users)`).all();
  const hasUsername = cols.some(c => c.name === 'username');
  if (!hasUsername) {
    db.prepare(`ALTER TABLE users ADD COLUMN username TEXT`).run();
    const existingIdx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_username_unique'`).get();
    if (!existingIdx) {
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username)`).run();
    }
  }
  const hasPhoto = cols.some(c => c.name === 'profile_photo_path');
  if (!hasPhoto) db.prepare(`ALTER TABLE users ADD COLUMN profile_photo_path TEXT`).run();
  const hasIsBanned = cols.some(c => c.name === 'is_banned');
  if (!hasIsBanned) db.prepare(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`).run();
  const hasSuspendedUntil = cols.some(c => c.name === 'suspended_until');
  if (!hasSuspendedUntil) db.prepare(`ALTER TABLE users ADD COLUMN suspended_until TEXT`).run();
  const hasUserUID = cols.some(c => c.name === 'user_uid');
  if (!hasUserUID) {
    db.prepare(`ALTER TABLE users ADD COLUMN user_uid TEXT`).run();
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_uid_unique ON users(user_uid)`).run();
  }
  const hasIsVerified = cols.some(c => c.name === 'is_verified');
  if (!hasIsVerified) db.prepare(`ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0`).run();
} catch (_) {}

db.prepare(`
  CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    gemini_api_key TEXT,
    bank_details TEXT,
    whatsapp_number TEXT
  )
`).run();

// Ensure new columns exist for older databases
try {
  const cols = db.prepare(`PRAGMA table_info(admin_config)`).all();
  const hasBank = cols.some(c => c.name === 'bank_details');
  if (!hasBank) db.prepare(`ALTER TABLE admin_config ADD COLUMN bank_details TEXT`).run();
  const hasWhats = cols.some(c => c.name === 'whatsapp_number');
  if (!hasWhats) db.prepare(`ALTER TABLE admin_config ADD COLUMN whatsapp_number TEXT`).run();
  const hasEmailApprove = cols.some(c => c.name === 'email_on_approve');
  if (!hasEmailApprove) db.prepare(`ALTER TABLE admin_config ADD COLUMN email_on_approve INTEGER NOT NULL DEFAULT 0`).run();
  const hasMaint = cols.some(c => c.name === 'maintenance_mode');
  if (!hasMaint) db.prepare(`ALTER TABLE admin_config ADD COLUMN maintenance_mode INTEGER NOT NULL DEFAULT 0`).run();
  const hasMaintMsg = cols.some(c => c.name === 'maintenance_message');
  if (!hasMaintMsg) db.prepare(`ALTER TABLE admin_config ADD COLUMN maintenance_message TEXT`).run();

  // New: separate bank fields
  const hasAccNum = cols.some(c => c.name === 'bank_account_number');
  if (!hasAccNum) db.prepare(`ALTER TABLE admin_config ADD COLUMN bank_account_number TEXT`).run();
  const hasAccName = cols.some(c => c.name === 'bank_account_name');
  if (!hasAccName) db.prepare(`ALTER TABLE admin_config ADD COLUMN bank_account_name TEXT`).run();
  const hasBankName = cols.some(c => c.name === 'bank_name');
  if (!hasBankName) db.prepare(`ALTER TABLE admin_config ADD COLUMN bank_name TEXT`).run();
} catch (_) {}

db.prepare(`
  CREATE TABLE IF NOT EXISTS payment_rules (
    category TEXT PRIMARY KEY,
    amount INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1
  )
`).run();

// Seed defaults
try {
  const defaults = [
    ['Vehicle', 300, 1],
    ['Property', 500, 1],
    ['Job', 200, 1],
    ['Electronic', 200, 1],
    ['Mobile', 0, 1],
    ['Home Garden', 200, 1],
    ['Other', 200, 1]
  ];
  const exists = db.prepare(`SELECT COUNT(*) as c FROM payment_rules`).get().c || 0;
  if (!exists) {
    const ins = db.prepare(`INSERT INTO payment_rules (category, amount, enabled) VALUES (?, ?, ?)`);
    for (const [cat, amt, en] of defaults) ins.run(cat, amt, en);
  }
} catch (_) {}

db.prepare(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )
`).run();

// Ensure single admin_config row
const existingConfig = db.prepare('SELECT id FROM admin_config WHERE id = 1').get();
if (!existingConfig) {
  db.prepare('INSERT INTO admin_config (id, gemini_api_key) VALUES (1, NULL)').run();
}

// Admin seed
(async () => {
  try {
    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'janithmanodaya2002@gmail.com').toLowerCase();
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;
    if (!ADMIN_PASSWORD) {
      console.warn('[admin-seed] ADMIN_PASSWORD not set. Skipping admin seeding.');
    } else {
      const user = db.prepare('SELECT id FROM users WHERE email = ?').get(ADMIN_EMAIL);
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      if (user) {
        db.prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, user.id);
      } else {
        db.prepare('INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)').run(
          ADMIN_EMAIL, hash, new Date().toISOString()
        );
      }
    }
  } catch (e) {}
})();

// Rate limits and routers
const authLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter, authRouter);

const adminLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/admin', adminLimiter, adminRouter);

// --- Global maintenance-mode gate (allow admin, health, and maintenance status; block everything else) ---
function isAdminRequest(req) {
  try {
    const hdr = String(req.headers['authorization'] || '');
    const parts = hdr.split(' ');
    if (parts.length !== 2 || !/^Bearer$/i.test(parts[0])) return false;
    const token = parts[1];
    const v = verifyTokenRaw(token);
    if (!v.ok) return false;
    const claims = v.decoded;
    const row = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(Number(claims.user_id));
    if (!row || !row.is_admin) return false;
    if (String(row.email).toLowerCase() !== String(claims.email).toLowerCase()) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Public maintenance status endpoint (allowed during maintenance)
app.get('/api/maintenance-status', (req, res) => {
  const { enabled, message } = getMaintenanceConfig();
  res.json({ enabled, message });
});

// SSE stream for maintenance status (reduces polling on clients)
app.get('/api/maintenance-status/stream', (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    function sendEvent(evName, data) {
      res.write(`event: ${evName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    function currentStatus() {
      const s = getMaintenanceConfig();
      return { enabled: !!s.enabled, message: String(s.message || '') };
    }

    // Initial push
    sendEvent('maintenance_status', currentStatus());

    // Periodic updates every 30s
    const intervalMs = 30000;
    const timer = setInterval(() => {
      try {
        sendEvent('maintenance_status', currentStatus());
      } catch (_) {}
    }, intervalMs);

    // Heartbeat every 15s
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(timer);
      clearInterval(hb);
      try { res.end(); } catch (_) {}
    });
  } catch (e) {
    try { res.status(500).json({ error: 'Failed to establish maintenance stream' }); } catch (_) {}
  }
});

app.use((req, res, next) => {
  const { enabled, message } = getMaintenanceConfig();
  if (!enabled) return next();

  // Allow admin API, health, and public maintenance status (and any admin-authenticated request)
  const p = String(req.path || '');
  if (p.startsWith('/api/admin') || p === '/api/health' || p === '/api/maintenance-status' || isAdminRequest(req)) {
    return next();
  }

  // For API calls, return JSON 503
  if (p.startsWith('/api/')) {
    return res.status(503).json({ error: 'Service under maintenance', message });
  }

  // For other GET requests, serve maintenance page
  res.status(503).type('text/html').send(renderMaintenancePage());
});

const listingsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/listings', listingsLimiter, listingsRouter);

const jobsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.use('/api/jobs', jobsLimiter, jobsRouter);

const notificationsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/notifications', notificationsLimiter, notificationsRouter);

const usersLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/users', usersLimiter, usersRouter);

const chatsLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
app.use('/api/chats', chatsLimiter, chatsRouter);

const wantedLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
app.use('/api/wanted', wantedLimiter, wantedRouter);

// Public banners
app.get('/api/banners', (req, res) => {
  try {
    const rows = db.prepare(`SELECT id, path FROM banners WHERE active = 1 ORDER BY sort_order ASC, id DESC LIMIT 12`).all();
    const items = rows.map(r => {
      const filename = String(r.path || '').split('/').pop();
      const url = filename ? `/uploads/${filename}` : null;
      return { id: r.id, url };
    }).filter(x => x.url);
    res.json({ results: items });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load banners' });
  }
});

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ganudenu.store', ts: new Date().toISOString() });
});

// Robots.txt and sitemap.xml copied from index.js
const domainDefault = 'https://ganudenu.store';
app.get('/robots.txt', (req, res) => {
  const domain = process.env.PUBLIC_DOMAIN || domainDefault;
  res.type('text/plain').send(`User-agent: *
Allow: /
Sitemap: ${domain}/sitemap.xml`);
});

app.get('/sitemap.xml', (req, res) => {
  const domain = process.env.PUBLIC_DOMAIN || domainDefault;
  const rows = db.prepare(`SELECT id, title, structured_json, created_at FROM listings WHERE status = 'Approved' ORDER BY id DESC LIMIT 3000`).all();

  function xmlEscape(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const nowIso = new Date().toISOString();
  const core = [
    { loc: `${domain}/`, lastmod: nowIso },
    { loc: `${domain}/jobs`, lastmod: nowIso },
    { loc: `${domain}/search`, lastmod: nowIso },
    { loc: `${domain}/policy`, lastmod: nowIso }
  ];

  function makeSlug(s) {
    const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return (base || 'listing').slice(0, 80);
  }
  function safeLastMod(v) {
    try {
      if (!v) return nowIso;
      const d = new Date(v);
      if (isNaN(d.getTime())) return nowIso;
      return d.toISOString();
    } catch (_) { return nowIso; }
  }

  const urls = [
    ...core,
    ...rows.map(r => {
      let year = '';
      try {
        const sj = JSON.parse(r.structured_json || '{}');
        const y = sj.manufacture_year || sj.year || sj.model_year || null;
        if (y) {
          const yy = parseInt(String(y), 10);
          if (Number.isFinite(yy) && yy >= 1950 && yy <= 2100) year = String(yy);
        }
      } catch (_) {}
      const idCode = Number(r.id).toString(36).toUpperCase();
      const parts = [makeSlug(r.title || ''), year, idCode].filter(Boolean);
      const rawLoc = `${domain}/listing/${r.id}-${parts.join('-')}`;
      const loc = xmlEscape(encodeURI(rawLoc));
      return { loc, lastmod: safeLastMod(r.created_at) };
    })
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${u.loc}</loc><lastmod>${xmlEscape(u.lastmod)}</lastmod></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// Background tasks (unchanged)
async function purgeExpiredListings() {
  try {
    const nowIso = new Date().toISOString();
    const expired = db.prepare(`
      SELECT id, thumbnail_path, medium_path, og_image_path
      FROM listings
      WHERE valid_until IS NOT NULL AND valid_until < ?
    `).all(nowIso);

    const delImagesStmt = db.prepare(`DELETE FROM listing_images WHERE listing_id = ?`);
    const clearListingImagesStmt = db.prepare(`
      UPDATE listings
      SET thumbnail_path = NULL,
          medium_path = NULL,
          og_image_path = NULL,
          status = 'Archived'
      WHERE id = ?
    `);

    let cleaned = 0;
    for (const row of expired) {
      try {
        const images = db.prepare(`SELECT path FROM listing_images WHERE listing_id = ?`).all(row.id);
        for (const img of images) {
          if (img?.path) { try { fs.unlinkSync(img.path); } catch (_) {} }
        }
      } catch (_) {}

      if (row?.thumbnail_path) { try { fs.unlinkSync(row.thumbnail_path); } catch (_) {} }
      if (row?.medium_path) { try { fs.unlinkSync(row.medium_path); } catch (_) {} }
      if (row?.og_image_path) { try { fs.unlinkSync(row.og_image_path); } catch (_) {} }

      // Remove image rows, keep listing metadata for analytics
      try { delImagesStmt.run(row.id); } catch (_) {}
      try { clearListingImagesStmt.run(row.id); } catch (_) {}
      cleaned++;
    }

    if (cleaned) {
      console.log(`[cleanup] Archived and removed images for ${cleaned} expired listings at ${new Date().toISOString()}`);
    }
  } catch (e) {
    console.error('[cleanup] Error during purge:', e);
  }
}
function purgeOldChats() {
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const info = db.prepare(`DELETE FROM chats WHERE created_at < ?`).run(cutoff);
    if (info.changes) console.log(`[cleanup] Purged ${info.changes} chats older than 7 days at ${new Date().toISOString()}`);
  } catch (e) {}
}
function purgeOldWantedRequests() {
  try {
    const cutoff = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const info = db.prepare(`DELETE FROM wanted_requests WHERE status = 'open' AND created_at < ?`).run(cutoff);
    if (info.changes) console.log(`[cleanup] Purged ${info.changes} wanted requests older than 15 days at ${new Date().toISOString()}`);
  } catch (e) {}
}
purgeExpiredListings();
purgeOldChats();
purgeOldWantedRequests();
setInterval(purgeExpiredListings, 60 * 60 * 1000);
setInterval(purgeOldChats, 60 * 60 * 1000);
setInterval(purgeOldWantedRequests, 60 * 60 * 1000);

async function sendSavedSearchEmailDigests() {
  try {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT id, title, message, target_email, created_at, listing_id
      FROM notifications
      WHERE type = 'saved_search'
        AND (emailed_at IS NULL OR emailed_at = '')
        AND created_at >= ?
        AND target_email IS NOT NULL
      ORDER BY target_email ASC, id ASC
      LIMIT 500
    `).all(sinceIso);

    if (!rows.length) return;

    const groups = {};
    for (const r of rows) {
      const k = String(r.target_email).toLowerCase().trim();
      if (!groups[k]) groups[k] = [];
      groups[k].push(r);
    }

    for (const [email, items] of Object.entries(groups)) {
      const domain = process.env.PUBLIC_DOMAIN || domainDefault;
      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; color: #111;">
          <h2 style="margin-bottom: 8px;">New listings matching your search</h2>
          <p style="margin-top: 0; color: #444;">Here are recent matches:</p>
          <ul>
            ${items.map(it => {
              const url = String(domain) + '/listing/' + String(it.listing_id || '');
              const dateStr = new Date(it.created_at).toLocaleString();
              return '<li><a href="' + url + '" style="color:#0b5fff;text-decoration:none;">' + it.message + '</a> <span style="color:#666;font-size:12px;">(' + dateStr + ')</span></li>';
            }).join('')}
          </ul>
          <p style="color:#666;font-size:12px;">You can manage saved searches from your Account page.</p>
        </div>
      `;
      const res = await sendEmail(email, 'New listings that match your saved search', html);
      if (res?.ok) {
        const now = new Date().toISOString();
        const stmt = db.prepare(`UPDATE notifications SET emailed_at = ? WHERE id = ?`);
        for (const it of items) {
          try { stmt.run(now, it.id); } catch (_) {}
        }
      } else {
        console.warn('[email:digest] Failed to send to', email, res?.error || res);
      }
    }
  } catch (e) {
    console.warn('[email:digest] Error:', e && e.message ? e.message : e);
  }
}
sendSavedSearchEmailDigests();
setInterval(sendSavedSearchEmailDigests, 15 * 60 * 1000);

export default app;