import { Router } from 'express';
import { db } from '../lib/db.js';
import { sendEmail } from '../lib/utils.js';
import { requireUser } from '../lib/auth.js';

const router = Router();

// Initialize wanted requests table
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS wanted_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_email TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT,
      location TEXT,
      price_max REAL,
      filters_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL
    )
  `).run();

  // Add dynamic columns if missing
  const cols = db.prepare(`PRAGMA table_info(wanted_requests)`).all();
  function ensureCol(name, typeSql) {
    if (!cols.find(c => String(c.name) === name)) {
      db.prepare(`ALTER TABLE wanted_requests ADD COLUMN ${name} ${typeSql}`).run();
    }
  }
  ensureCol('locations_json', 'TEXT');         // JSON array of locations (strings)
  ensureCol('models_json', 'TEXT');            // JSON array of models (strings)
  ensureCol('year_min', 'INTEGER');            // Vehicle only
  ensureCol('year_max', 'INTEGER');            // Vehicle only
  ensureCol('price_min', 'REAL');              // Lower bound for price
  ensureCol('price_not_matter', 'INTEGER NOT NULL DEFAULT 0'); // treat price as non-constraint

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_wanted_status ON wanted_requests(status)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_wanted_user ON wanted_requests(user_email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_wanted_category ON wanted_requests(category)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_wanted_created ON wanted_requests(created_at)`).run();
} catch (_) {}

const CATEGORIES = new Set(['Vehicle', 'Property', 'Job', 'Electronic', 'Mobile', 'Home Garden', 'Other']);
const DOMAIN = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';

// Helper: value normalization
function parseJsonArray(s) {
  try {
    const arr = JSON.parse(String(s || '[]'));
    return Array.isArray(arr) ? arr.map(x => String(x).trim()).filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}
function normLower(s) { return String(s || '').trim().toLowerCase(); }
function extractYearFromStruct(sj) {
  try {
    const y = sj.manufacture_year ?? sj.year ?? sj.model_year ?? null;
    if (y == null) return null;
    const num = parseInt(String(y).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(num)) return null;
    if (num < 1950 || num > 2100) return null;
    return num;
  } catch (_) {
    return null;
  }
}

// Helper: does a listing match a wanted request (dynamic by category)
function listingMatchesWanted(listing, wanted) {
  try {
    const cat = String(wanted.category || '').trim();
    const catOk = cat ? String(listing.main_category || '') === cat : true;

    // Locations: match if listing.location contains ANY wanted location (case-insensitive)
    const locs = parseJsonArray(wanted.locations_json);
    const fallbackLoc = String(wanted.location || '').trim();
    if (fallbackLoc) locs.push(fallbackLoc);
    const listingLoc = normLower(listing.location);
    const locOk = locs.length ? locs.some(l => listingLoc.includes(normLower(l))) : true;

    // Price range (respect price_not_matter)
    const p = listing.price != null ? Number(listing.price) : null;
    const priceNotMatter = wanted.price_not_matter ? true : false;
    const pMin = wanted.price_min != null ? Number(wanted.price_min) : null;
    const pMax = wanted.price_max != null ? Number(wanted.price_max) : null;
    const priceOk = priceNotMatter
      ? true
      : (p == null ? false
         : ((pMin == null || p >= pMin) && (pMax == null || p <= pMax)));

    // Models: for Vehicle/Mobile/Electronic only, partial match of model_name against any wanted model
    let modelsOk = true;
    if (['Vehicle', 'Mobile', 'Electronic'].includes(cat)) {
      const models = parseJsonArray(wanted.models_json);
      if (models.length) {
        let sj = {};
        try { sj = listing.structured_json ? JSON.parse(listing.structured_json) : {}; } catch (_) { sj = {}; }
        const gotModel = normLower(sj.model_name || sj.model || '');
        modelsOk = models.some(m => gotModel.includes(normLower(m)));
      }
    }

    // Year range: Vehicle only
    let yearOk = true;
    if (cat === 'Vehicle') {
      const yearMin = wanted.year_min != null ? Number(wanted.year_min) : null;
      const yearMax = wanted.year_max != null ? Number(wanted.year_max) : null;
      let sj = {};
      try { sj = listing.structured_json ? JSON.parse(listing.structured_json) : {}; } catch (_) { sj = {}; }
      const y = extractYearFromStruct(sj);
      if (yearMin != null || yearMax != null) {
        if (y == null) yearOk = false;
        else {
          yearOk = (yearMin == null || y >= yearMin) && (yearMax == null || y <= yearMax);
        }
      }
    }

    // Optional filters_json for future extension (exact/partial semantics similar to saved searches)
    let filtersOk = true;
    let filters = {};
    try { filters = wanted.filters_json ? JSON.parse(wanted.filters_json) : {}; } catch (_) { filters = {}; }
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

    return catOk && locOk && priceOk && modelsOk && yearOk && filtersOk;
  } catch (_) {
    return false;
  }
}

// Create a wanted request
router.post('/', requireUser, async (req, res) => {
  try {
    const email = req.user.email;
    const {
      title,
      description = '',
      category = '',
      locations = [],
      models = [],
      year_min = null,
      year_max = null,
      price_min = null,
      price_max = null,
      price_not_matter = false,
      filters = {}
    } = req.body || {};

    const t = String(title || '').trim();
    if (!t || t.length < 6) return res.status(400).json({ error: 'Title must be at least 6 characters' });
    const cat = String(category || '').trim();
    if (cat && !CATEGORIES.has(cat)) return res.status(400).json({ error: 'Invalid category' });

    const locs = Array.isArray(locations) ? locations.map(s => String(s).trim()).filter(Boolean) : [];
    const firstLoc = locs[0] || '';

    const mdl = Array.isArray(models) ? models.map(s => String(s).trim()).filter(Boolean) : [];
    const yMin = year_min != null && year_min !== '' ? Number(year_min) : null;
    const yMax = year_max != null && year_max !== '' ? Number(year_max) : null;
    const pMin = price_min != null && price_min !== '' ? Number(price_min) : null;
    const pMax = price_max != null && price_max !== '' ? Number(price_max) : null;
    const priceNo = !!price_not_matter;

    if (yMin != null && (!Number.isFinite(yMin) || yMin < 1950 || yMin > 2100)) return res.status(400).json({ error: 'Invalid year_min' });
    if (yMax != null && (!Number.isFinite(yMax) || yMax < 1950 || yMax > 2100)) return res.status(400).json({ error: 'Invalid year_max' });
    if (pMin != null && (!Number.isFinite(pMin) || pMin < 0)) return res.status(400).json({ error: 'Invalid price_min' });
    if (pMax != null && (!Number.isFinite(pMax) || pMax < 0)) return res.status(400).json({ error: 'Invalid price_max' });

    let filtersJson = '{}';
    try { filtersJson = JSON.stringify(filters || {}); } catch (_) { filtersJson = '{}'; }

    const ts = new Date().toISOString();
    const ins = db.prepare(`
      INSERT INTO wanted_requests
        (user_email, title, description, category, location, price_max, filters_json, status, created_at,
         locations_json, models_json, year_min, year_max, price_min, price_not_matter)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = ins.run(
      email,
      t,
      String(description || '').trim(),
      cat || null,
      firstLoc || null,
      pMax,
      filtersJson,
      ts,
      JSON.stringify(locs),
      JSON.stringify(mdl),
      yMin,
      yMax,
      pMin,
      priceNo ? 1 : 0
    );
    const id = result.lastInsertRowid;

    // Immediately notify sellers with matching existing approved listings (in-app only)
    let sellerNotified = 0;
    const matchedListings = [];
    try {
      const listings = db.prepare(`
        SELECT id, title, main_category, location, price, structured_json, owner_email
        FROM listings
        WHERE status = 'Approved'
        ORDER BY created_at DESC
        LIMIT 1000
      `).all();
      for (const l of listings) {
        if (listingMatchesWanted(l, {
          category: cat,
          locations_json: JSON.stringify(locs),
          models_json: JSON.stringify(mdl),
          year_min: yMin,
          year_max: yMax,
          price_min: pMin,
          price_max: pMax,
          price_not_matter: priceNo,
          filters_json: filtersJson
        })) {
          const owner = String(l.owner_email || '').toLowerCase().trim();
          if (!owner) continue;
          db.prepare(`
            INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
            VALUES (?, ?, ?, ?, 'wanted_match_seller', ?, ?)
          `).run(
            'Immediate buyer request for your item',
            `A buyer posted a request: "${t}". Your ad "${l.title}" may match.`,
            owner,
            new Date().toISOString(),
            l.id,
            JSON.stringify({ wanted_id: id })
          );
          sellerNotified++;
          if (matchedListings.length < 10) matchedListings.push({ id: l.id, title: l.title });
        }
      }
    } catch (_) {}

    // Notify buyer: in-app only (no email on post)
    db.prepare(`
      INSERT INTO notifications (title, message, target_email, created_at, type, meta_json)
      VALUES (?, ?, ?, ?, 'wanted_posted', ?)
    `).run(
      'Your Wanted request was posted',
      sellerNotified > 0
        ? `We found ${sellerNotified} potential matches. Sellers have been notified.`
        : 'We will notify you when new matching ads are listed.',
      email,
      new Date().toISOString(),
      JSON.stringify({ wanted_id: id, matches_count: sellerNotified })
    );

    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create wanted request' });
  }
});

// List open wanted requests (public)
router.get('/', (req, res) => {
  try {
    const { q = '', category = '', location = '', limit = '50' } = req.query;
    const lim = Math.max(1, Math.min(200, parseInt(String(limit), 10) || 50));
    let sql = `
      SELECT w.id, w.user_email, u.username AS poster_username, w.title, w.description, w.category, w.location,
             w.price_min, w.price_max, w.price_not_matter,
             w.filters_json, w.locations_json, w.models_json, w.year_min, w.year_max, w.status, w.created_at
      FROM wanted_requests w
      LEFT JOIN users u ON LOWER(u.email) = LOWER(w.user_email)
      WHERE w.status = 'open'
    `;
    const params = [];
    if (category) { sql += ' AND w.category = ?'; params.push(String(category)); }
    if (location) { sql += ' AND (LOWER(w.location) LIKE ? OR LOWER(COALESCE(w.locations_json,\'\')) LIKE ?)'; params.push('%' + String(location).toLowerCase() + '%', '%' + String(location).toLowerCase() + '%'); }
    if (q) {
      const term = '%' + String(q).toLowerCase() + '%';
      sql += ' AND (LOWER(w.title) LIKE ? OR LOWER(w.description) LIKE ?)';
      params.push(term, term);
    }
    sql += ' ORDER BY w.created_at DESC LIMIT ?';
    params.push(lim);
    const rows = db.prepare(sql).all(params);
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load wanted requests' });
  }
});

// List my wanted requests
router.get('/my', requireUser, (req, res) => {
  try {
    const email = req.user.email;
    const rows = db.prepare(`
      SELECT w.id, w.user_email, u.username AS poster_username, w.title, w.description, w.category, w.location,
             w.price_min, w.price_max, w.price_not_matter,
             w.filters_json, w.locations_json, w.models_json, w.year_min, w.year_max, w.status, w.created_at
      FROM wanted_requests w
      LEFT JOIN users u ON LOWER(u.email) = LOWER(w.user_email)
      WHERE LOWER(w.user_email) = LOWER(?)
      ORDER BY w.id DESC
      LIMIT 200
    `).all(email);
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load your wanted requests' });
  }
});

// Close a wanted request
router.post('/:id/close', requireUser, (req, res) => {
  try {
    const email = req.user.email;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const row = db.prepare('SELECT user_email, status FROM wanted_requests WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (String(row.user_email || '').toLowerCase().trim() !== email) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    db.prepare('UPDATE wanted_requests SET status = ? WHERE id = ?').run('closed', id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to close request' });
  }
});

// Seller: respond to a wanted request with one of your listings
router.post('/respond', requireUser, async (req, res) => {
  try {
    const email = req.user.email;
    const { wanted_id, listing_id, message = '' } = req.body || {};
    const wid = Number(wanted_id);
    const lid = Number(listing_id);
    if (!Number.isFinite(wid) || !Number.isFinite(lid)) {
      return res.status(400).json({ error: 'wanted_id and listing_id are required' });
    }
    const wanted = db.prepare('SELECT * FROM wanted_requests WHERE id = ?').get(wid);
    if (!wanted || wanted.status !== 'open') return res.status(404).json({ error: 'Wanted request not open' });
    const listing = db.prepare('SELECT id, title, owner_email FROM listings WHERE id = ?').get(lid);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    const owner = String(listing.owner_email || '').toLowerCase().trim();
    if (owner !== email) return res.status(403).json({ error: 'You can only respond with your own listing' });

    // Notify buyer
    db.prepare(`
      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
      VALUES (?, ?, ?, ?, 'wanted_response', ?, ?)
    `).run(
      'A seller responded to your Wanted request',
      `Seller offered: "${listing.title}". ${String(message || '').trim()}`,
      String(wanted.user_email).toLowerCase().trim(),
      new Date().toISOString(),
      listing.id,
      JSON.stringify({ wanted_id: wanted.id, seller_email: email })
    );
    // Notify seller (confirmation)
    db.prepare(`
      INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
      VALUES (?, ?, ?, ?, 'wanted_response_sent', ?, ?)
    `).run(
      'Your offer was sent',
      `We notified the buyer about your ad "${listing.title}".`,
      email,
      new Date().toISOString(),
      listing.id,
      JSON.stringify({ wanted_id: wanted.id })
    );

    // Email both buyer and seller
    try {
      const buyerHtml = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
          <h2 style="margin:0 0 10px 0;">A seller responded to your Wanted request</h2>
          <p style="margin:0 0 10px 0;">Offered ad: <strong>${listing.title}</strong></p>
          <p style="margin:0;">${String(message || '').trim()}</p>
          <p style="margin:10px 0 0 0;"><a href="${DOMAIN}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
        </div>
      `;
      await sendEmail(String(wanted.user_email).toLowerCase().trim(), 'Seller response to your Wanted request', buyerHtml);
    } catch (_) {}
    try {
      const sellerHtml = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
          <h2 style="margin:0 0 10px 0;">Your offer was sent</h2>
          <p style="margin:0 0 10px 0;">We notified the buyer about your ad "<strong>${listing.title}</strong>".</p>
          <p style="margin:10px 0 0 0;"><a href="${DOMAIN}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
        </div>
      `;
      await sendEmail(email, 'Your offer was sent', sellerHtml);
    } catch (_) {}

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to respond to wanted request' });
  }
});

// Internal: notify for a given listing (reverse match)
router.post('/notify-for-listing', async (req, res) => {
  try {
    const id = Number(req.body?.listingId);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listingId' });
    const listing = db.prepare('SELECT id, title, main_category, location, price, structured_json, owner_email FROM listings WHERE id = ?').get(id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    const wantedRows = db.prepare(`SELECT * FROM wanted_requests WHERE status = 'open'`).all();
    let buyerNotified = 0;
    let sellerNotified = 0;
    for (const w of wantedRows) {
      if (listingMatchesWanted(listing, w)) {
        // Notify buyer
        db.prepare(`
          INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
          VALUES (?, ?, ?, ?, 'wanted_match_buyer', ?, ?)
        `).run(
          'New ad matches your Wanted request',
          `Match: "${listing.title}". View the ad for details.`,
          String(w.user_email).toLowerCase().trim(),
          new Date().toISOString(),
          listing.id,
          JSON.stringify({ wanted_id: w.id })
        );
        try {
          const html = `
            <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
              <h2 style="margin:0 0 10px 0;">New match for your Wanted request</h2>
              <p style="margin:0 0 10px 0;">Matched ad: <strong>${listing.title}</strong></p>
              <p style="margin:10px 0 0 0;"><a href="${DOMAIN}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
            </div>
          `;
          await sendEmail(String(w.user_email).toLowerCase().trim(), 'New match for your Wanted request', html);
        } catch (_) {}
        buyerNotified++;

        // Notify seller
        const owner = String(listing.owner_email || '').toLowerCase().trim();
        if (owner) {
          db.prepare(`
            INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
            VALUES (?, ?, ?, ?, 'wanted_match_seller', ?, ?)
          `).run(
            'Immediate buyer request for your item',
            `A buyer posted: "${w.title}". Your ad may match.`,
            owner,
            new Date().toISOString(),
            listing.id,
            JSON.stringify({ wanted_id: w.id })
          );
          try {
            const html = `
              <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
                <h2 style="margin:0 0 10px 0;">Immediate buyer request</h2>
                <p style="margin:0 0 10px 0;">A buyer posted: "<strong>${w.title}</strong>". Your ad "<strong>${listing.title}</strong>" may match.</p>
                <p style="margin:10px 0 0 0;"><a href="${DOMAIN}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View your ad</a></p>
              </div>
            `;
            await sendEmail(owner, 'Immediate buyer request for your item', html);
          } catch (_) {}
          sellerNotified++;
        }
      }
    }
    res.json({ ok: true, buyerNotified, sellerNotified });
  } catch (e) {
    res.status(500).json({ error: 'Failed to notify wanted matches' });
  }
});

export default router;
