import { Router } from 'express';
import { db } from '../lib/db.js';

const router = Router();

// Ensure notifications tables
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_email TEXT,
      created_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notification_id INTEGER NOT NULL,
      user_email TEXT NOT NULL,
      read_at TEXT NOT NULL,
      UNIQUE(notification_id, user_email)
    )
  `).run();

  // Saved searches: per-user saved queries
  db.prepare(`
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
  `).run();

  // Add new columns for enhanced behavior
  try {
    const cols = db.prepare(`PRAGMA table_info(notifications)`).all();
    const hasType = cols.some(c => c.name === 'type');
    if (!hasType) {
      db.prepare(`ALTER TABLE notifications ADD COLUMN type TEXT DEFAULT 'general'`).run();
    }
    const hasListing = cols.some(c => c.name === 'listing_id');
    if (!hasListing) {
      db.prepare(`ALTER TABLE notifications ADD COLUMN listing_id INTEGER`).run();
    }
    const hasMeta = cols.some(c => c.name === 'meta_json');
    if (!hasMeta) {
      db.prepare(`ALTER TABLE notifications ADD COLUMN meta_json TEXT`).run();
    }
    const hasEmailed = cols.some(c => c.name === 'emailed_at');
    if (!hasEmailed) {
      db.prepare(`ALTER TABLE notifications ADD COLUMN emailed_at TEXT`).run();
    }
  } catch (_) {}

  // Indexes
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_listing ON notifications(listing_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notifications_emailed ON notifications(emailed_at)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notif_reads_user ON notification_reads(user_email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notif_reads_notif ON notification_reads(notification_id)`).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_searches_cat ON saved_searches(category)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_saved_searches_loc ON saved_searches(location)`).run();
} catch (_) {}

// Lightweight user gate via header
function requireUser(req, res, next) {
  const email = String(req.header('X-User-Email') || '').toLowerCase().trim();
  if (!email) return res.status(401).json({ error: 'Missing user email' });
  // Optional: check user exists
  const user = db.prepare('SELECT id, is_banned, suspended_until FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid user' });
  if (user.is_banned) return res.status(403).json({ error: 'Account banned' });
  if (user.suspended_until && user.suspended_until > new Date().toISOString()) {
    return res.status(403).json({ error: 'Account suspended' });
  }
  req.user = { email, id: user.id };
  next();
}

// Get notifications for user (broadcast + targeted), with TTLs:
// - Read items are shown only for 24h after read
// - Unread non-pending items are shown only for 7 days after creation
// - Pending items are always shown until approved/rejected (regardless of read state)
router.get('/', requireUser, (req, res) => {
  const email = req.user.email;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const readCutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const unreadCutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = db.prepare(`
    SELECT n.id, n.title, n.message, n.target_email, n.created_at, n.type, n.listing_id, n.meta_json, n.emailed_at,
      CASE WHEN r.id IS NULL THEN 0 ELSE 1 END AS is_read,
      r.read_at as read_at
    FROM notifications n
    LEFT JOIN notification_reads r
      ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
    WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
      AND (
        n.type = 'pending'
        OR (r.id IS NOT NULL AND r.read_at >= ?)
        OR (r.id IS NULL AND n.created_at >= ?)
      )
    ORDER BY n.id DESC
    LIMIT ?
  `).all(email, email, readCutoffIso, unreadCutoffIso, limit);

  const unreadCount = rows.reduce((acc, r) => acc + (r.is_read ? 0 : 1), 0);

  res.json({ results: rows, unread_count: unreadCount });
});

// Unread count only (exclude non-pending older than 7 days)
router.get('/unread-count', requireUser, (req, res) => {
  const email = req.user.email;
  const unreadCutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const count = db.prepare(`
    SELECT COUNT(*) as c
    FROM notifications n
    LEFT JOIN notification_reads r
      ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
    WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
      AND r.id IS NULL
      AND (n.type = 'pending' OR n.created_at >= ?)
  `).get(email, email, unreadCutoffIso).c || 0;

  res.json({ unread_count: count });
});

// Mark a notification as read
router.post('/:id/read', requireUser, (req, res) => {
  const email = req.user.email;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    db.prepare(`
      INSERT OR IGNORE INTO notification_reads (notification_id, user_email, read_at)
      VALUES (?, ?, ?)
    `).run(id, email, new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// ---------- Saved Searches API ----------

// Create or update a saved search
router.post('/saved-searches', requireUser, (req, res) => {
  try {
    const email = req.user.email;
    const { name = '', category = '', location = '', price_min = '', price_max = '', filters = {} } = req.body || {};
    const nm = String(name || '').trim();
    const cat = String(category || '').trim();
    const loc = String(location || '').trim();
    const pmin = price_min !== '' && price_min != null ? Number(price_min) : null;
    const pmax = price_max !== '' && price_max != null ? Number(price_max) : null;
    let filtersJson = '{}';
    try { filtersJson = JSON.stringify(filters || {}); } catch (_) { filtersJson = '{}'; }

    const ts = new Date().toISOString();
    db.prepare(`
      INSERT INTO saved_searches (user_email, name, category, location, price_min, price_max, filters_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(email, nm, cat, loc, pmin, pmax, filtersJson, ts);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save search' });
  }
});

// List saved searches
router.get('/saved-searches', requireUser, (req, res) => {
  try {
    const email = req.user.email;
    const rows = db.prepare(`
      SELECT id, name, category, location, price_min, price_max, filters_json, created_at
      FROM saved_searches
      WHERE LOWER(user_email) = LOWER(?)
      ORDER BY id DESC
      LIMIT 100
    `).all(email);
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list saved searches' });
  }
});

// Delete a saved search
router.delete('/saved-searches/:id', requireUser, (req, res) => {
  try {
    const email = req.user.email;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT user_email FROM saved_searches WHERE id = ?').get(id);
    if (!row || String(row.user_email).toLowerCase().trim() !== email) {
      return res.status(404).json({ error: 'Not found' });
    }
    db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete saved search' });
  }
});

// Helper to check if a listing matches a saved search
function listingMatchesSearch(listing, search) {
  try {
    const catOk = search.category ? String(listing.main_category || '') === String(search.category || '') : true;
    const locOk = search.location ? String(listing.location || '').toLowerCase().includes(String(search.location || '').toLowerCase()) : true;
    const p = listing.price != null ? Number(listing.price) : null;
    const pMinOk = search.price_min != null ? (p != null && p >= Number(search.price_min)) : true;
    const pMaxOk = search.price_max != null ? (p != null && p <= Number(search.price_max)) : true;

    let filtersOk = true;
    let filters = {};
    try { filters = search.filters_json ? JSON.parse(search.filters_json) : {}; } catch (_) { filters = {}; }
    if (filters && Object.keys(filters).length) {
      const sj = listing.structured_json ? JSON.parse(listing.structured_json) : {};
      for (const [k, v] of Object.entries(filters)) {
        if (!v) continue;
        const key = k === 'model' ? 'model_name' : k;
        const got = String(sj[key] || '').toLowerCase();

        if (Array.isArray(v)) {
          const wants = v.map(x => String(x).toLowerCase()).filter(Boolean);
          if (key === 'model_name' || key === 'sub_category') {
            if (!wants.some(w => got.includes(w))) { filtersOk = false; break; }
          } else {
            if (!wants.some(w => got === w)) { filtersOk = false; break; }
          }
        } else {
          const want = String(v).toLowerCase();
          if (key === 'model_name' || key === 'sub_category') {
            if (!got.includes(want)) { filtersOk = false; break; }
          } else {
            if (got !== want) { filtersOk = false; break; }
          }
        }
      }
    }
    return catOk && locOk && pMinOk && pMaxOk && filtersOk;
  } catch (_) {
    return false;
  }
}

// Best-effort: when a new listing is approved, notify users whose saved searches match
// This utility can be called from listings routes after approval, but as a fallback we expose an endpoint to trigger checks.
router.post('/saved-searches/notify-for-listing', (req, res) => {
  try {
    const { listingId } = req.body || {};
    const id = Number(listingId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listingId' });
    const listing = db.prepare('SELECT id, title, main_category, location, price, structured_json, created_at FROM listings WHERE id = ?').get(id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const searches = db.prepare('SELECT * FROM saved_searches').all();
    let notified = 0;
    for (const s of searches) {
      if (listingMatchesSearch(listing, s)) {
        try {
          db.prepare(`
            INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
            VALUES (?, ?, ?, ?, 'saved_search', ?, ?)
          `).run(
            'New listing matches your search',
            `A new "${listing.title}" matches your saved search.`,
            s.user_email,
            new Date().toISOString(),
            listing.id,
            JSON.stringify({ saved_search_id: s.id })
          );
          notified++;
        } catch (_) {}
      }
    }
    res.json({ ok: true, notified });
  } catch (e) {
    res.status(500).json({ error: 'Failed to notify saved searches' });
  }
});

// -------- Server-Sent Events (SSE) stream for unread count --------
// Allows clients to subscribe without frequent polling.
// Authentication: user email can be provided via X-User-Email header or `user_email` query param.
router.get('/unread-count/stream', (req, res) => {
  try {
    const emailHeader = String(req.header('X-User-Email') || '').toLowerCase().trim();
    const emailQuery = String(req.query.user_email || '').toLowerCase().trim();
    const email = emailHeader || emailQuery;
    if (!email) return res.status(401).type('application/json').send(JSON.stringify({ error: 'Missing user email' }));

    // Validate user and bans/suspension
    const user = db.prepare('SELECT id, is_banned, suspended_until FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).type('application/json').send(JSON.stringify({ error: 'Invalid user' }));
    if (user.is_banned) return res.status(403).type('application/json').send(JSON.stringify({ error: 'Account banned' }));
    if (user.suspended_until && user.suspended_until > new Date().toISOString()) {
      return res.status(403).type('application/json').send(JSON.stringify({ error: 'Account suspended' }));
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    function computeUnread() {
      const unreadCutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const count = db.prepare(`
        SELECT COUNT(*) as c
        FROM notifications n
        LEFT JOIN notification_reads r
          ON r.notification_id = n.id AND LOWER(r.user_email) = LOWER(?)
        WHERE (n.target_email IS NULL OR LOWER(n.target_email) = LOWER(?))
          AND r.id IS NULL
          AND (n.type = 'pending' OR n.created_at >= ?)
      `).get(email, email, unreadCutoffIso).c || 0;
      return Number(count || 0);
    }

    function sendEvent(evName, data) {
      res.write(`event: ${evName}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }

    // Initial push
    sendEvent('unread_count', { unread_count: computeUnread() });

    // Periodic updates (every 30s to reduce load)
    const intervalMs = 30000;
    const timer = setInterval(() => {
      try {
        sendEvent('unread_count', { unread_count: computeUnread() });
      } catch (_) {}
    }, intervalMs);

    // Heartbeat every 15s to keep connection alive through proxies
    const hb = setInterval(() => {
      try { res.write(': ping\n\n'); } catch (_) {}
    }, 15000);

    req.on('close', () => {
      clearInterval(timer);
      clearInterval(hb);
      try { res.end(); } catch (_) {}
    });
  } catch (e) {
    try { res.status(500).json({ error: 'Failed to establish unread-count stream' }); } catch (_) {}
  }
});

export default router;