import { Router } from 'express';
import { db } from '../lib/db.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { sendEmail } from '../lib/utils.js';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { requireAdmin, requireAdmin2FA } from '../lib/auth.js';

// Dynamic sharp import for image processing
let sharp = null;
(async () => {
  try { sharp = (await import('sharp')).default; } catch (_) { sharp = null; }
})();

const router = Router();

// Init audit table
db.prepare(`
  CREATE TABLE IF NOT EXISTS admin_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    listing_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    reason TEXT,
    ts TEXT NOT NULL
  )
`).run();

// Reports table
db.prepare(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL,
    reporter_email TEXT,
    reason TEXT NOT NULL,
    ts TEXT NOT NULL,
    FOREIGN KEY(listing_id) REFERENCES listings(id) ON DELETE CASCADE
  )
`).run();

// Ensure new columns exist on reports for management
try {
  const cols = db.prepare(`PRAGMA table_info(reports)`).all();
  const hasStatus = cols.some(c => c.name === 'status');
  if (!hasStatus) {
    db.prepare(`ALTER TABLE reports ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`).run();
  }
  const hasHandledBy = cols.some(c => c.name === 'handled_by');
  if (!hasHandledBy) {
    db.prepare(`ALTER TABLE reports ADD COLUMN handled_by INTEGER`).run();
  }
  const hasHandledAt = cols.some(c => c.name === 'handled_at');
  if (!hasHandledAt) {
    db.prepare(`ALTER TABLE reports ADD COLUMN handled_at TEXT`).run();
  }
} catch (_) {}

// Upload config
const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({
  dest: uploadsDir,
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const mt = String(file.mimetype || '');
    if (!mt.startsWith('image/')) return cb(new Error('Only images are allowed'));
    if (mt === 'image/svg+xml') return cb(new Error('SVG images are not allowed'));
    cb(null, true);
  }
});

// Get current Gemini API key (masked)
router.get('/config', requireAdmin, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT bank_details, whatsapp_number, email_on_approve, maintenance_mode, maintenance_message,
             bank_account_number, bank_account_name, bank_name
      FROM admin_config
      WHERE id = 1
    `).get() || {};

    // Load payment rules (best-effort)
    let rules = [];
    try {
      rules = db.prepare(`SELECT category, amount, enabled FROM payment_rules ORDER BY category ASC`).all();
    } catch (_) {
      rules = [];
    }

    // Optional: return masked Gemini key if present in secure storage
    let gemini_api_key_masked = null;
    try {
      const { getSecret } = require('../lib/secure-config.js');
      const key = getSecret('gemini_api_key');
      if (key && typeof key === 'string') {
        const s = key.trim();
        if (s.length <= 8) {
          gemini_api_key_masked = '****';
        } else {
          gemini_api_key_masked = `${s.slice(0, 4)}••••${s.slice(-4)}`;
        }
      }
    } catch (_) {
      gemini_api_key_masked = null;
    }

    return res.json({
      bank_details: row.bank_details || '',
      bank_account_number: row.bank_account_number || '',
      bank_account_name: row.bank_account_name || '',
      bank_name: row.bank_name || '',
      whatsapp_number: row.whatsapp_number || '',
      email_on_approve: !!row.email_on_approve,
      maintenance_mode: !!row.maintenance_mode,
      maintenance_message: row.maintenance_message || '',
      payment_rules: rules,
      secrets_managed: true,
      gemini_api_key_masked
    });
  } catch (e) {
    // Return a safe JSON payload instead of 500 to keep admin UI responsive
    return res.json({
      bank_details: '',
      bank_account_number: '',
      bank_account_name: '',
      bank_name: '',
      whatsapp_number: '',
      email_on_approve: false,
      maintenance_mode: false,
      maintenance_message: '',
      payment_rules: [],
      secrets_managed: true,
      gemini_api_key_masked: null
    });
  }
});

// Save Gemini API key
router.post('/config', requireAdmin, (req, res) => {
  const { bankDetails, whatsappNumber, emailOnApprove, paymentRules, maintenanceMode, maintenanceMessage, bankAccountNumber, bankAccountName, bankName } = req.body || {};

  if (bankDetails && typeof bankDetails !== 'string') {
    return res.status(400).json({ error: 'bankDetails must be string.' });
  }
  if (whatsappNumber && typeof whatsappNumber !== 'string') {
    return res.status(400).json({ error: 'whatsappNumber must be string.' });
  }
  if (maintenanceMessage && typeof maintenanceMessage !== 'string') {
    return res.status(400).json({ error: 'maintenanceMessage must be string.' });
  }
  if (bankAccountNumber && typeof bankAccountNumber !== 'string') {
    return res.status(400).json({ error: 'bankAccountNumber must be string.' });
  }
  if (bankAccountName && typeof bankAccountName !== 'string') {
    return res.status(400).json({ error: 'bankAccountName must be string.' });
  }
  if (bankName && typeof bankName !== 'string') {
    return res.status(400).json({ error: 'bankName must be string.' });
  }

  const row = db.prepare('SELECT id FROM admin_config WHERE id = 1').get();
  if (!row) db.prepare('INSERT INTO admin_config (id) VALUES (1)').run();
  db.prepare('UPDATE admin_config SET bank_details = COALESCE(?, bank_details), whatsapp_number = COALESCE(?, whatsapp_number), email_on_approve = COALESCE(?, email_on_approve), maintenance_mode = COALESCE(?, maintenance_mode), maintenance_message = COALESCE(?, maintenance_message), bank_account_number = COALESCE(?, bank_account_number), bank_account_name = COALESCE(?, bank_account_name), bank_name = COALESCE(?, bank_name) WHERE id = 1')
    .run(
      bankDetails ? bankDetails.trim() : null,
      whatsappNumber ? whatsappNumber.trim() : null,
      (emailOnApprove == null ? null : (emailOnApprove ? 1 : 0)),
      (maintenanceMode == null ? null : (maintenanceMode ? 1 : 0)),
      maintenanceMessage != null ? String(maintenanceMessage).trim() : null,
      bankAccountNumber ? bankAccountNumber.trim() : null,
      bankAccountName ? bankAccountName.trim() : null,
      bankName ? bankName.trim() : null
    );

  // Update payment rules if provided
  if (Array.isArray(paymentRules)) {
    const up = db.prepare(`INSERT INTO payment_rules (category, amount, enabled) VALUES (?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET amount = excluded.amount, enabled = excluded.enabled`);
    for (const rule of paymentRules) {
      const cat = String(rule.category || '').trim();
      const amount = Number(rule.amount);
      const enabled = rule.enabled ? 1 : 0;
      if (!cat) continue;
      if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) continue;
      up.run(cat, Math.round(amount), enabled);
    }
  }

  res.json({ ok: true });
});

// Test Gemini API key by calling a lightweight public endpoint
import { getSecret } from '../lib/secure-config.js';

router.post('/test-gemini', requireAdmin, async (req, res) => {
  const key = getSecret('gemini_api_key');
  if (!key) return res.status(400).json({ error: 'No Gemini API key configured.' });
  try {
    const url = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`;
    const r = await fetch(url, { method: 'GET' });
    const ok = r.ok;
    const data = await r.json().catch(() => ({}));
    if (!ok) {
      return res.status(r.status).json({ ok: false, error: data?.error || data });
    }
    return res.json({ ok: true, models_count: Array.isArray(data.models) ? data.models.length : 0 });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Network or API error.' });
  }
});

// Prompt management

router.get('/prompts', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT type, content FROM prompts').all();
  const map = {};
  for (const row of rows) map[row.type] = row.content;
  res.json(map);
});

router.post('/prompts', requireAdmin, (req, res) => {
  const { listing_extraction, seo_metadata, resume_extraction } = req.body || {};
  const entries = [
    ['listing_extraction', listing_extraction],
    ['seo_metadata', seo_metadata],
    ['resume_extraction', resume_extraction],
  ];

  for (const [type, content] of entries) {
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: `Prompt "${type}" is required.` });
    }
  }

  const upsert = db.prepare(`
    INSERT INTO prompts (type, content) VALUES (?, ?)
    ON CONFLICT(type) DO UPDATE SET content = excluded.content
  `);

  for (const [type, content] of entries) {
    upsert.run(type, content.trim());
  }

  res.json({ ok: true });
});

// Approval queue

router.get('/pending', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, main_category, title, description, seo_title, seo_description, created_at, remark_number, price, owner_email
    FROM listings
    WHERE status = 'Pending Approval'
    ORDER BY created_at ASC
  `).all();
  res.json({ items: rows });
});

router.get('/pending/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id.' });
  const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!listing) return res.status(404).json({ error: 'Listing not found.' });
  const images = db.prepare('SELECT id, path, original_name FROM listing_images WHERE listing_id = ?').all(id);
  const seo = listing.seo_json ? JSON.parse(listing.seo_json) : {
    seo_title: listing.seo_title || '',
    meta_description: listing.seo_description || '',
    seo_keywords: listing.seo_keywords || ''
  };
  res.json({ listing, images, seo });
});

router.post('/pending/:id/update', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { structured_json, seo_title, meta_description, seo_keywords } = req.body || {};
  if (typeof structured_json !== 'string' || typeof seo_title !== 'string' || typeof meta_description !== 'string' || typeof seo_keywords !== 'string') {
    return res.status(400).json({ error: 'Invalid payload.' });
  }
  // Validate structured_json is valid JSON
  try { JSON.parse(structured_json); } catch (_) {
    return res.status(400).json({ error: 'structured_json must be valid JSON.' });
  }
  const st = seo_title.slice(0, 60);
  const sd = meta_description.slice(0, 160);
  const sk = seo_keywords;

  db.prepare(`
    UPDATE listings
    SET structured_json = ?, seo_title = ?, seo_description = ?, seo_keywords = ?, seo_json = ?
    WHERE id = ?
  `).run(structured_json.trim(), st.trim(), sd.trim(), sk.trim(), JSON.stringify({ seo_title: st, meta_description: sd, seo_keywords: sk }, null, 2), id);

  db.prepare(`
    INSERT INTO admin_actions (admin_id, listing_id, action, ts)
    VALUES (?, ?, 'update', ?)
  `).run(req.admin.id, id, new Date().toISOString());

  res.json({ ok: true });
});

router.post('/pending/:id/approve', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  // Load listing to get owner and title
  const listing = db.prepare(`SELECT id, title, owner_email, main_category, location, price, structured_json, phone FROM listings WHERE id = ?`).get(id);

  // Set status to 'Approved' to match public listing queries
  db.prepare(`UPDATE listings SET status = 'Approved', reject_reason = NULL WHERE id = ?`).run(id);
  db.prepare(`
    INSERT INTO admin_actions (admin_id, listing_id, action, ts)
    VALUES (?, ?, 'approve', ?)
  `).run(req.admin.id, id, new Date().toISOString());

  // Remove any pending notifications for this listing and create an approved notification
  try {
    if (listing?.owner_email) {
      db.prepare(`DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'`).run(id);
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
        VALUES (?, ?, ?, ?, 'approved', ?)
      `).run(
        'Listing Approved',
        `Good news! Your ad "${listing.title}" (#${id}) has been approved and is now live.`,
        String(listing.owner_email).toLowerCase().trim(),
        new Date().toISOString(),
        id
      );
    }
  } catch (_) {}

  // --- External Facebook post service integration (best-effort; non-blocking) ---
  let fbPostUrl = null;
  try {
    const serviceUrl = process.env.FB_SERVICE_URL || process.env.FACEBOOK_POST_SERVICE_URL || '';
    const apiKey = process.env.FB_SERVICE_API_KEY || process.env.FACEBOOK_POST_SERVICE_API_KEY || '';
    if (serviceUrl && apiKey && listing) {
      const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
      function filePathToUrlAbs(p) {
        if (!p) return null;
        const filename = String(p).split(/[\\\/]/).pop();
        return filename ? domain + '/uploads/' + filename : null;
      }
      const imgs = db.prepare('SELECT path, medium_path FROM listing_images WHERE listing_id = ? ORDER BY id ASC LIMIT 3').all(id);
      const image_urls = imgs.map(it => filePathToUrlAbs(it.medium_path || it.path)).filter(Boolean);

      const user = listing?.owner_email ? db.prepare('SELECT username FROM users WHERE LOWER(email) = LOWER(?)').get(String(listing.owner_email).toLowerCase().trim()) : null;
      const seller_name = (user?.username && String(user.username).trim()) ? String(user.username).trim() : String(listing?.owner_email || '').split('@')[0];

      let details = {};
      try { details = listing?.structured_json ? JSON.parse(listing.structured_json) : {}; } catch (_) { details = {}; }

      const payload = {
        listing_id: listing.id,
        title: listing.title,
        seller_name,
        category: listing.main_category,
        location: listing.location || '',
        price: listing.price != null ? Number(listing.price) : null,
        phone: listing?.phone || '',
        images: image_urls,
        details,
        source_listing_url: domain + '/listing/' + listing.id
      };

      const r = await fetch(String(serviceUrl).replace(/\/$/, '') + '/api/facebook/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify(payload)
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data?.post_url) {
        fbPostUrl = String(data.post_url);
        try {
          db.prepare('UPDATE listings SET facebook_post_url = ? WHERE id = ?').run(fbPostUrl, id);
        } catch (_) {}
      } else {
        console.warn('[fb] service failed', r.status, data?.error || data);
      }
    }
  } catch (e) {
    console.warn('[fb] error:', e && e.message ? e.message : e);
  }

  // Notify users with saved searches that match this listing
  try {
    const searches = db.prepare('SELECT * FROM saved_searches').all();
    let notified = 0;

    function listingMatchesSearch(listingRow, search) {
      try {
        const catOk = search.category ? String(listingRow.main_category || '') === String(search.category || '') : true;
        const locOk = search.location ? String(listingRow.location || '').toLowerCase().includes(String(search.location || '').toLowerCase()) : true;
        const p = listingRow.price != null ? Number(listingRow.price) : null;
        const pMinOk = search.price_min != null ? (p != null && p >= Number(search.price_min)) : true;
        const pMaxOk = search.price_max != null ? (p != null && p <= Number(search.price_max)) : true;

        let filtersOk = true;
        let filters = {};
        try { filters = search.filters_json ? JSON.parse(search.filters_json) : {}; } catch (_) { filters = {}; }
        if (filters && Object.keys(filters).length) {
          const sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {};
          for (const [k, v] of Object.entries(filters)) {
            if (v == null || v === '') continue;
            const key = k === 'model' ? 'model_name' : k;
            const got = String(sj[key] || '').toLowerCase();

            // Support multi-select arrays
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

    for (const s of searches) {
      if (listingMatchesSearch(listing, s)) {
        try {
          db.prepare(`
            INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
            VALUES (?, ?, ?, ?, 'saved_search', ?, ?)
          `).run(
            'New listing matches your search',
            `A new "${listing.title}" matches your saved search.`,
            String(s.user_email).toLowerCase().trim(),
            new Date().toISOString(),
            listing.id,
            JSON.stringify({ saved_search_id: s.id })
          );
          notified++;
        } catch (_) {}
      }
    }
    if (notified) {
      console.log(`[notify] Saved-search alerts created for ${notified} users for listing #${id}`);
    }
  } catch (e) {
    console.warn('[notify] Saved-search notification error:', e && e.message ? e.message : e);
  }

  // Notify buyers and sellers for matching Wanted requests (reverse notifications)
  try {
    if (listing) {
      const wantedRows = db.prepare(`SELECT * FROM wanted_requests WHERE status = 'open'`).all();
      let buyerNotified = 0;
      let sellerNotified = 0;

      function listingMatchesWanted(listingRow, wanted) {
        try {
          const cat = String(wanted.category || '').trim();
          const catOk = cat ? String(listingRow.main_category || '') === cat : true;

          // Locations: match if listing.location contains ANY wanted location (case-insensitive)
          function parseArr(jsonText) {
            try {
              const arr = JSON.parse(String(jsonText || '[]'));
              return Array.isArray(arr) ? arr.map(x => String(x).trim()).filter(Boolean) : [];
            } catch (_) {
              return [];
            }
          }
          const locs = parseArr(wanted.locations_json);
          const fallbackLoc = String(wanted.location || '').trim();
          if (fallbackLoc) locs.push(fallbackLoc);
          const listingLoc = String(listingRow.location || '').toLowerCase();
          const locOk = locs.length ? locs.some(l => listingLoc.includes(String(l).toLowerCase())) : true;

          // Price range (respect price_not_matter)
          const p = listingRow.price != null ? Number(listingRow.price) : null;
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
            const models = parseArr(wanted.models_json);
            if (models.length) {
              let sj = {};
              try { sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {}; } catch (_) { sj = {}; }
              const gotModel = String(sj.model_name || sj.model || '').toLowerCase();
              modelsOk = models.some(m => gotModel.includes(String(m).toLowerCase()));
            }
          }

          // Year range: Vehicle only
          let yearOk = true;
          if (cat === 'Vehicle') {
            const yearMin = wanted.year_min != null ? Number(wanted.year_min) : null;
            const yearMax = wanted.year_max != null ? Number(wanted.year_max) : null;
            let sj = {};
            try { sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {}; } catch (_) { sj = {}; }
            const rawY = sj.manufacture_year ?? sj.year ?? sj.model_year ?? null;
            let y = null;
            if (rawY != null) {
              const num = parseInt(String(rawY).replace(/[^0-9]/g, ''), 10);
              y = Number.isFinite(num) ? num : null;
            }
            if (yearMin != null || yearMax != null) {
              if (y == null) yearOk = false;
              else {
                yearOk = (yearMin == null || y >= yearMin) && (yearMax == null || y <= yearMax);
              }
            }
          }

          // Optional filters_json for future extension
          let filtersOk = true;
          let filters = {};
          try { filters = wanted.filters_json ? JSON.parse(wanted.filters_json) : {}; } catch (_) { filters = {}; }
          if (filters && Object.keys(filters).length) {
            const sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {};
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
          // Email buyer
          try {
            const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
            const html = `
              <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
                <h2 style="margin:0 0 10px 0;">New match for your Wanted request</h2>
                <p style="margin:0 0 10px 0;">Matched ad: <strong>${listing.title}</strong></p>
                <p style="margin:10px 0 0 0;"><a href="${domain}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
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
            // Email seller
            try {
              const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
              const html = `
                <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
                  <h2 style="margin:0 0 10px 0;">Immediate buyer request</h2>
                  <p style="margin:0 0 10px 0;">A buyer posted: "<strong>${w.title}</strong>". Your ad "<strong>${listing.title}</strong>" may match.</p>
                  <p style="margin:10px 0 0 0;"><a href="${domain}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View your ad</a></p>
                </div>
              `;
              await sendEmail(owner, 'Immediate buyer request for your item', html);
            } catch (_) {}
            sellerNotified++;
          }
        }
      }
      if (buyerNotified || sellerNotified) {
        console.log(`[notify] Wanted reverse alerts created (buyers: ${buyerNotified}, sellers: ${sellerNotified}) for listing #${listing.id}`);
      }
    }
  } catch (e) {
    console.warn('[notify] Wanted notification error:', e && e.message ? e.message : e);
  }

  // Notify tagged Wanted request owners (explicit tags chosen by seller during posting)
  try {
    const tagRows = db.prepare('SELECT wanted_id FROM listing_wanted_tags WHERE listing_id = ?').all(id);
    if (Array.isArray(tagRows) && tagRows.length) {
      const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
      for (const row of tagRows) {
        const wid = Number(row.wanted_id);
        if (!Number.isFinite(wid)) continue;
        const wanted = db.prepare('SELECT id, user_email, title FROM wanted_requests WHERE id = ?').get(wid);
        if (!wanted || !wanted.user_email) continue;
        // In-app notification
        try {
          db.prepare(`
            INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
            VALUES (?, ?, ?, ?, 'wanted_tag_buyer', ?, ?)
          `).run(
            'A new ad was posted for your request',
            `Tagged by seller: "${listing.title}".`,
            String(wanted.user_email).toLowerCase().trim(),
            new Date().toISOString(),
            id,
            JSON.stringify({ wanted_id: wid })
          );
        } catch (_) {}
        // Email the buyer
        try {
          const html = `
            <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
              <h2 style="margin:0 0 10px 0;">A new ad was posted for your request</h2>
              <p style="margin:0 0 10px 0;">Seller tagged your request: <strong>${wanted.title}</strong></p>
              <p style="margin:0 0 10px 0;">Ad: <strong>${listing.title}</strong></p>
              <p style="margin:10px 0 0 0;"><a href="${domain}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
            </div>
          `;
          await sendEmail(String(wanted.user_email).toLowerCase().trim(), 'A new ad was posted for your request', html);
        } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[notify] Tag-based notification error:', e && e.message ? e.message : e);
  }

  // If we have a Facebook post URL, notify the listing owner and optionally email them
  try {
    if (fbPostUrl && listing?.owner_email) {
      const target = String(listing.owner_email).toLowerCase().trim();
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
        VALUES (?, ?, ?, ?, 'facebook_post', ?, ?)
      `).run(
        'Your ad was shared on Facebook',
        `Your ad "${listing.title}" has been shared on our Facebook page. View it here: ${fbPostUrl}`,
        target,
        new Date().toISOString(),
        listing.id,
        JSON.stringify({ facebook_post_url: fbPostUrl })
      );

      const cfg = db.prepare('SELECT email_on_approve FROM admin_config WHERE id = 1').get();
      const emailOnApprove = !!(cfg && cfg.email_on_approve);
      if (emailOnApprove) {
        const html = `
          <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
            <h2 style="margin:0 0 10px 0;">Your ad was shared on Facebook</h2>
            <p style="margin:0 0 8px 0;">We have shared your approved ad "<strong>${listing.title}</strong>" on our Facebook page.</p>
            <p style="margin:0 0 12px 0;"><a href="${fbPostUrl}" style="color:#0b5fff;text-decoration:none;">View Facebook post</a></p>
            <p style="color:#666;font-size:12px;margin:0;">Listing ID: ${listing.id}</p>
          </div>
        `;
        const sent = await sendEmail(target, 'Your ad was shared on Facebook', html);
        if (!sent?.ok) {
          console.warn('[email] approve email failed:', sent?.error || sent);
        }
      }
    }
  } catch (e) {
    console.warn('[notify] Facebook post notification/email error:', e && e.message ? e.message : e);
  }

  res.json({ ok: true });
});

router.post('/pending/:id/reject', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'Reject reason is required.' });
  }
  // Load listing to get owner and title (for targeted notification)
  const listing = db.prepare(`SELECT id, title, owner_email FROM listings WHERE id = ?`).get(id);

  db.prepare(`UPDATE listings SET status = 'Rejected', reject_reason = ? WHERE id = ?`).run(reason.trim(), id);
  db.prepare(`
    INSERT INTO admin_actions (admin_id, listing_id, action, reason, ts)
    VALUES (?, ?, 'reject', ?, ?)
  `).run(req.admin.id, id, reason.trim(), new Date().toISOString());

  // Remove any pending notifications and create a rejected notification
  try {
    if (listing?.owner_email) {
      db.prepare(`DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'`).run(id);
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
        VALUES (?, ?, ?, ?, 'rejected', ?)
      `).run(
        'Listing Rejected',
        `We’re sorry. Your ad "${listing.title}" (#${id}) was rejected.\nReason: ${reason.trim()}`,
        String(listing.owner_email).toLowerCase().trim(),
        new Date().toISOString(),
        id
      );
    }
  } catch (_) {}

  res.json({ ok: true });
});

// Approve many
router.post('/pending/approve_many', requireAdmin, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

  const stmt = db.prepare(`UPDATE listings SET status = 'Approved', reject_reason = NULL WHERE id = ?`);
  const audit = db.prepare(`INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, 'approve', ?)`);
  const delPending = db.prepare(`DELETE FROM notifications WHERE listing_id = ? AND type = 'pending'`);
  const insApproved = db.prepare(`
    INSERT INTO notifications (title, message, target_email, created_at, type, listing_id)
    VALUES (?, ?, ?, ?, 'approved', ?)
  `);

  let notified = 0;
  for (const rawId of ids) {
    const id = Number(rawId);
    stmt.run(id);
    audit.run(req.admin.id, id, new Date().toISOString());

    try {
      const listing = db.prepare(`SELECT id, title, owner_email, main_category, location, price, structured_json FROM listings WHERE id = ?`).get(id);
      if (listing?.owner_email) {
        delPending.run(id);
        insApproved.run(
          'Listing Approved',
          `Good news! Your ad "${listing.title}" (#${id}) has been approved and is now live.`,
          String(listing.owner_email).toLowerCase().trim(),
          new Date().toISOString(),
          id
        );

        // Reverse notifications for Wanted requests
        try {
          const wantedRows = db.prepare(`SELECT * FROM wanted_requests WHERE status = 'open'`).all();
          function listingMatchesWanted(listingRow, wanted) {
            try {
              const cat = String(wanted.category || '').trim();
              const catOk = cat ? String(listingRow.main_category || '') === cat : true;

              function parseArr(jsonText) {
                try {
                  const arr = JSON.parse(String(jsonText || '[]'));
                  return Array.isArray(arr) ? arr.map(x => String(x).trim()).filter(Boolean) : [];
                } catch (_) {
                  return [];
                }
              }

              // Locations
              const locs = parseArr(wanted.locations_json);
              const fallbackLoc = String(wanted.location || '').trim();
              if (fallbackLoc) locs.push(fallbackLoc);
              const listingLoc = String(listingRow.location || '').toLowerCase();
              const locOk = locs.length ? locs.some(l => listingLoc.includes(String(l).toLowerCase())) : true;

              // Price range
              const p = listingRow.price != null ? Number(listingRow.price) : null;
              const priceNotMatter = wanted.price_not_matter ? true : false;
              const pMin = wanted.price_min != null ? Number(wanted.price_min) : null;
              const pMax = wanted.price_max != null ? Number(wanted.price_max) : null;
              const priceOk = priceNotMatter
                ? true
                : (p == null ? false
                   : ((pMin == null || p >= pMin) && (pMax == null || p <= pMax)));

              // Models
              let modelsOk = true;
              if (['Vehicle', 'Mobile', 'Electronic'].includes(cat)) {
                const models = parseArr(wanted.models_json);
                if (models.length) {
                  let sj = {};
                  try { sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {}; } catch (_) { sj = {}; }
                  const gotModel = String(sj.model_name || sj.model || '').toLowerCase();
                  modelsOk = models.some(m => gotModel.includes(String(m).toLowerCase()));
                }
              }

              // Year range
              let yearOk = true;
              if (cat === 'Vehicle') {
                const yearMin = wanted.year_min != null ? Number(wanted.year_min) : null;
                const yearMax = wanted.year_max != null ? Number(wanted.year_max) : null;
                let sj = {};
                try { sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {}; } catch (_) { sj = {}; }
                const rawY = sj.manufacture_year ?? sj.year ?? sj.model_year ?? null;
                let y = null;
                if (rawY != null) {
                  const num = parseInt(String(rawY).replace(/[^0-9]/g, ''), 10);
                  y = Number.isFinite(num) ? num : null;
                }
                if (yearMin != null || yearMax != null) {
                  if (y == null) yearOk = false;
                  else {
                    yearOk = (yearMin == null || y >= yearMin) && (yearMax == null || y <= yearMax);
                  }
                }
              }

              // Optional filters_json
              let filtersOk = true;
              let filters = {};
              try { filters = wanted.filters_json ? JSON.parse(wanted.filters_json) : {}; } catch (_) { filters = {}; }
              if (filters && Object.keys(filters).length) {
                const sj = listingRow.structured_json ? JSON.parse(listingRow.structured_json) : {};
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
              }
            }
          }
        } catch (_) {}

        // Tag-based notifications for explicit Wanted tags on this listing
        try {
          const tagRows = db.prepare('SELECT wanted_id FROM listing_wanted_tags WHERE listing_id = ?').all(id);
          if (Array.isArray(tagRows) && tagRows.length) {
            const domain = process.env.PUBLIC_DOMAIN || 'https://ganudenu.store';
            for (const row of tagRows) {
              const wid = Number(row.wanted_id);
              if (!Number.isFinite(wid)) continue;
              const wanted = db.prepare('SELECT id, user_email, title FROM wanted_requests WHERE id = ?').get(wid);
              if (!wanted || !wanted.user_email) continue;
              // In-app
              try {
                db.prepare(`
                  INSERT INTO notifications (title, message, target_email, created_at, type, listing_id, meta_json)
                  VALUES (?, ?, ?, ?, 'wanted_tag_buyer', ?, ?)
                `).run(
                  'A new ad was posted for your request',
                  `Tagged by seller: "${listing.title}".`,
                  String(wanted.user_email).toLowerCase().trim(),
                  new Date().toISOString(),
                  id,
                  JSON.stringify({ wanted_id: wid })
                );
              } catch (_) {}
              // Email the buyer (best-effort, non-blocking)
              try {
                const html = `
                  <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
                    <h2 style="margin:0 0 10px 0;">A new ad was posted for your request</h2>
                    <p style="margin:0 0 10px 0;">Seller tagged your request: <strong>${wanted.title}</strong></p>
                    <p style="margin:0 0 10px 0;">Ad: <strong>${listing.title}</strong></p>
                    <p style="margin:10px 0 0 0;"><a href="${(process.env.PUBLIC_DOMAIN || 'https://ganudenu.store')}/listing/${listing.id}" style="color:#0b5fff;text-decoration:none;">View ad</a></p>
                  </div>
                `;
                // Fire and forget
                sendEmail(String(wanted.user_email).toLowerCase().trim(), 'A new ad was posted for your request', html).catch(() => {});
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  res.json({ ok: true });
});
    
// Flag listing
router.post('/flag', requireAdmin, (req, res) => {
  const { listing_id, reason } = req.body || {};
  if (!listing_id || !reason) return res.status(400).json({ error: 'listing_id and reason required' });
  db.prepare(`INSERT INTO admin_actions (admin_id, listing_id, action, reason, ts) VALUES (?, ?, 'flag', ?, ?)`)
    .run(req.admin.id, Number(listing_id), String(reason).trim(), new Date().toISOString());
  res.json({ ok: true });
});

// List reports with optional status filter
router.get('/reports', requireAdmin, (req, res) => {
  const status = (req.query.status || '').toLowerCase();
  let rows;
  if (status === 'pending' || status === 'resolved') {
    rows = db.prepare(`SELECT * FROM reports WHERE status = ? ORDER BY id DESC LIMIT 500`).all(status);
  } else {
    rows = db.prepare(`SELECT * FROM reports ORDER BY id DESC LIMIT 500`).all();
  }
  res.json({ results: rows });
});

// Resolve a report
router.post('/reports/:id/resolve', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?`).run(
    req.admin.id,
    new Date().toISOString(),
    id
  );
  res.json({ ok: true });
});

// Delete a report
router.delete('/reports/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM reports WHERE id = ?`).run(id);
  res.json({ ok: true });
});

// Banner management (admin)
router.get('/banners', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`SELECT id, path, active, sort_order, created_at FROM banners ORDER BY sort_order ASC, id DESC`).all();
    const items = rows.map(r => {
      const filename = String(r.path || '').split('/').pop();
      const url = filename ? `/uploads/${filename}` : null;
      return { id: r.id, url, active: !!r.active, sort_order: r.sort_order, created_at: r.created_at };
    });
    res.json({ results: items });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load banners' });
  }
});

// Admin metrics and analytics (expanded, with ranged filters)
router.get('/metrics', requireAdmin, (req, res) => {
  try {
    const now = new Date();
    const nowIso = now.toISOString();

    // Range param: days=7|30 (default 14)
    let daysParam = Number(req.query.days);
    if (!Number.isFinite(daysParam) || daysParam <= 0) daysParam = 14;
    if (daysParam > 60) daysParam = 60; // sanity limit
    const rangeStart = new Date(now);
    rangeStart.setUTCHours(0, 0, 0, 0);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - (daysParam - 1)); // include today
    const rangeStartIso = rangeStart.toISOString();

    const totalUsers = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c || 0;
    const bannedUsers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE is_banned = 1`).get().c || 0;
    const suspendedUsers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE suspended_until IS NOT NULL AND suspended_until > ?`).get(nowIso).c || 0;

    const totalListings = db.prepare(`SELECT COUNT(*) as c FROM listings`).get().c || 0;
    const activeListings = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status IN ('Approved','Active')`).get().c || 0;
    const pendingListings = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status = 'Pending Approval'`).get().c || 0;
    const rejectedListings = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE status = 'Rejected'`).get().c || 0;

    const reportPending = db.prepare(`SELECT COUNT(*) as c FROM reports WHERE status = 'pending'`).get().c || 0;
    const reportResolved = db.prepare(`SELECT COUNT(*) as c FROM reports WHERE status = 'resolved'`).get().c || 0;

    // Visitors (distinct IPs)
    let visitorsTotal = 0;
    let visitorsInRange = 0;
    try {
      visitorsTotal = db.prepare(`SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ip IS NOT NULL AND TRIM(ip) <> ''`).get().c || 0;
      visitorsInRange = db.prepare(`SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ts >= ? AND ip IS NOT NULL AND TRIM(ip) <> ''`).get(rangeStartIso).c || 0;
    } catch (_) {}

    // Filesystem stats
    const dataDir = path.resolve(process.cwd(), 'data');
    const uploadsDir = path.join(dataDir, 'uploads');

    function safeStat(p) {
      try { return fs.statSync(p); } catch (_) { return null; }
    }
    function countFilesRec(dir, opts = {}) {
      const st = safeStat(dir);
      if (!st || !st.isDirectory()) return 0;
      let count = 0;
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        const s = safeStat(p);
        if (!s) continue;
        if (s.isDirectory()) {
          // Optionally skip certain dirs
          if (opts.skip && opts.skip.has(entry)) continue;
          count += countFilesRec(p, opts);
        } else if (s.isFile()) {
          if (opts.filterExt) {
            const ext = path.extname(entry).toLowerCase();
            if (!opts.filterExt.has(ext)) continue;
          }
          count += 1;
        }
      }
      return count;
    }
    function listFilesRec(dir, opts = {}) {
      const st = safeStat(dir);
      if (!st || !st.isDirectory()) return [];
      const out = [];
      for (const entry of fs.readdirSync(dir)) {
        const p = path.join(dir, entry);
        const s = safeStat(p);
        if (!s) continue;
        if (s.isDirectory()) {
          if (opts.skip && opts.skip.has(entry)) continue;
          out.push(...listFilesRec(p, opts));
        } else if (s.isFile()) {
          if (opts.filterExt) {
            const ext = path.extname(entry).toLowerCase();
            if (!opts.filterExt.has(ext)) continue;
          }
          out.push({ path: p, stat: s });
        }
      }
      return out;
    }

    // Count images under uploads (any file considered an image as we store webp/png/jpg)
    let imagesCount = 0;
    let uploadsDiskUsageBytes = 0;
    let imageEntries = [];
    try {
      const exts = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif', '.tiff']);
      imageEntries = listFilesRec(uploadsDir, { filterExt: exts });
      imagesCount = imageEntries.length;
      // Fallback: if ext filtering yields 0 but uploads dir exists, count all files
      if (imagesCount === 0) {
        imageEntries = listFilesRec(uploadsDir);
        imagesCount = imageEntries.length;
      }
      uploadsDiskUsageBytes = imageEntries.reduce((acc, f) => acc + (f.stat?.size || 0), 0);
    } catch (_) {}

    // Count databases (.sqlite) under data (including tmp_ai)
    let databasesCount = 0;
    try {
      const sqliteExts = new Set(['.sqlite', '.db']);
      databasesCount = countFilesRec(dataDir, { filterExt: sqliteExts });
    } catch (_) {}

    // Count system files under data excluding uploads (to avoid double-counting images)
    let systemFilesCount = 0;
    try {
      systemFilesCount = countFilesRec(dataDir, { skip: new Set(['uploads']) });
    } catch (_) {}

    // Count all files under project root (exclude common heavy dirs)
    let allFilesCount = 0;
    try {
      const root = process.cwd();
      allFilesCount = countFilesRec(root, { skip: new Set(['node_modules', '.git']) });
    } catch (_) {}

    // Range-limited totals
    const usersNewInRange = db.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ?`).get(rangeStartIso).c || 0;
    const listingsNewInRange = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE created_at >= ?`).get(rangeStartIso).c || 0;
    const approvalsInRange = db.prepare(`SELECT COUNT(*) as c FROM admin_actions WHERE action='approve' AND ts >= ?`).get(rangeStartIso).c || 0;
    const rejectionsInRange = db.prepare(`SELECT COUNT(*) as c FROM admin_actions WHERE action='reject' AND ts >= ?`).get(rangeStartIso).c || 0;
    const reportsInRange = db.prepare(`SELECT COUNT(*) as c FROM reports WHERE ts >= ?`).get(rangeStartIso).c || 0;

    // Time series helpers
    function dayRangeDays(nDays) {
      const days = [];
      for (let i = nDays - 1; i >= 0; i--) {
        const start = new Date();
        start.setUTCHours(0, 0, 0, 0);
        start.setUTCDate(start.getUTCDate() - i);
        const end = new Date(start);
        end.setUTCDate(start.getUTCDate() + 1);
        days.push({ start, end });
      }
      return days;
    }

    const win = dayRangeDays(daysParam);

    const signups = win.map(({ start, end }) => {
      const c = db.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= ? AND created_at < ?`)
        .get(start.toISOString(), end.toISOString()).c || 0;
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    const listingsCreated = win.map(({ start, end }) => {
      const c = db.prepare(`SELECT COUNT(*) as c FROM listings WHERE created_at >= ? AND created_at < ?`)
        .get(start.toISOString(), end.toISOString()).c || 0;
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    const approvals = win.map(({ start, end }) => {
      const c = db.prepare(`SELECT COUNT(*) as c FROM admin_actions WHERE action = 'approve' AND ts >= ? AND ts < ?`)
        .get(start.toISOString(), end.toISOString()).c || 0;
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    const rejections = win.map(({ start, end }) => {
      const c = db.prepare(`SELECT COUNT(*) as c FROM admin_actions WHERE action = 'reject' AND ts >= ? AND ts < ?`)
        .get(start.toISOString(), end.toISOString()).c || 0;
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    const reports = win.map(({ start, end }) => {
      const c = db.prepare(`SELECT COUNT(*) as c FROM reports WHERE ts >= ? AND ts < ?`)
        .get(start.toISOString(), end.toISOString()).c || 0;
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    // Visitors per day (distinct IPs)
    const visitorsPerDay = win.map(({ start, end }) => {
      let c = 0;
      try {
        c = db.prepare(`SELECT COUNT(DISTINCT ip) AS c FROM listing_views WHERE ts >= ? AND ts < ? AND ip IS NOT NULL AND TRIM(ip) <> ''`)
          .get(start.toISOString(), end.toISOString()).c || 0;
      } catch (_) { c = 0; }
      return { date: start.toISOString().slice(0, 10), count: c };
    });

    // Images added per day (based on file mtime in uploads)
    const imagesAddedPerDay = (() => {
      const buckets = new Map(); // key: 'YYYY-MM-DD' -> count
      for (const { stat } of imageEntries) {
        if (!stat?.mtime) continue;
        const d = new Date(stat.mtime);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      return win.map(({ start }) => {
        const key = start.toISOString().slice(0, 10);
        return { date: key, count: buckets.get(key) || 0 };
      });
    })();

    // Top categories among approved/active listings
    const topCategories = db.prepare(`
      SELECT main_category as category, COUNT(*) as cnt
      FROM listings
      WHERE status IN ('Approved','Active') AND main_category IS NOT NULL AND main_category <> ''
      GROUP BY main_category
      ORDER BY cnt DESC
      LIMIT 8
    `).all();

    // Status breakdown
    const statusBreakdown = [
      { status: 'Active/Approved', count: activeListings },
      { status: 'Pending Approval', count: pendingListings },
      { status: 'Rejected', count: rejectedListings },
    ];

    res.json({
      params: { days: daysParam, rangeStart: rangeStartIso },
      totals: {
        totalUsers, bannedUsers, suspendedUsers,
        totalListings, activeListings, pendingListings, rejectedListings,
        reportPending, reportResolved,
        visitorsTotal,
        imagesCount,
        systemFilesCount,
        databasesCount,
        uploadsDiskUsageBytes,
        allFilesCount
      },
      rangeTotals: {
        usersNewInRange,
        listingsNewInRange,
        approvalsInRange,
        rejectionsInRange,
        reportsInRange,
        visitorsInRange
      },
      series: {
        signups,
        listingsCreated,
        approvals,
        rejections,
        reports,
        visitorsPerDay,
        imagesAddedPerDay
      },
      topCategories,
      statusBreakdown
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load metrics' });
  }
});

// User management
router.get('/users', requireAdmin, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  let rows;
  if (q) {
    rows = db.prepare(`
      SELECT id, email, username, is_admin, is_banned, suspended_until, created_at, user_uid, is_verified
      FROM users
      WHERE LOWER(email) LIKE ? OR LOWER(COALESCE(username,'')) LIKE ?
      ORDER BY id DESC
      LIMIT ?
    `).all(`%${q}%`, `%${q}%`, limit);
  } else {
    rows = db.prepare(`
      SELECT id, email, username, is_admin, is_banned, suspended_until, created_at, user_uid, is_verified
      FROM users
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
  }
  res.json({ results: rows });
});

// Verify/unverify user
router.post('/users/:id/verify', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE users SET is_verified = 1 WHERE id = ?`).run(id);
  // optional notification
  try {
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'verify')
      `).run(
        'Account Verified',
        `Your account has been verified by an administrator.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true });
});

router.post('/users/:id/unverify', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE users SET is_verified = 0 WHERE id = ?`).run(id);
  res.json({ ok: true });
});

router.post('/users/:id/ban', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE users SET is_banned = 1, suspended_until = NULL WHERE id = ?`).run(id);

  // Notify the user about ban
  try {
    const user = db.prepare(`SELECT email, username FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'ban')
      `).run(
        'Account Banned',
        `Your account has been banned by an administrator. If you believe this is a mistake, please contact support.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true });
});

router.post('/users/:id/unban', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE users SET is_banned = 0, suspended_until = NULL WHERE id = ?`).run(id);

  // Notify the user about unban
  try {
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'unban')
      `).run(
        'Account Unbanned',
        `Good news! Your account ban has been lifted and you can use Ganudenu again.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true });
});

router.post('/users/:id/suspend7', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET is_banned = 0, suspended_until = ? WHERE id = ?`).run(until, id);

  // Notify the user about suspension
  try {
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      const untilDate = new Date(until);
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'suspend')
      `).run(
        'Account Suspended',
        `Your account has been temporarily suspended until ${untilDate.toLocaleString()}. You won't be able to log in during this period.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true, suspended_until: until });
});

// Suspend with custom day count
router.post('/users/:id/suspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  let days = Number(req.body?.days);
  if (!Number.isFinite(days) || days <= 0) days = 7; // default/fallback
  if (days > 365) days = 365; // sanity limit 1 year max
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`UPDATE users SET is_banned = 0, suspended_until = ? WHERE id = ?`).run(until, id);

  // Notify the user about suspension
  try {
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      const untilDate = new Date(until);
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'suspend')
      `).run(
        'Account Suspended',
        `Your account has been temporarily suspended for ${days} day(s), until ${untilDate.toLocaleString()}. You won't be able to log in during this period.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true, suspended_until: until, days });
});

// Unsuspend user (clear suspension)
router.post('/users/:id/unsuspend', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`UPDATE users SET suspended_until = NULL WHERE id = ?`).run(id);

  // Notify the user about unsuspension
  try {
    const user = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id);
    if (user?.email) {
      db.prepare(`
        INSERT INTO notifications (title, message, target_email, created_at, type)
        VALUES (?, ?, ?, ?, 'unsuspend')
      `).run(
        'Account Unsuspended',
        `Your account suspension has been lifted. You can now log in and use Ganudenu.`,
        String(user.email).toLowerCase().trim(),
        new Date().toISOString()
      );
    }
  } catch (_) {}
  res.json({ ok: true });
});

router.post('/banners', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Image file required' });
    // basic signature check + block SVG
    try {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(8);
      fs.readSync(fd, buf, 0, 8, 0);
      fs.closeSync(fd);
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isSvg = String(f.mimetype || '') === 'image/svg+xml';
      if (isSvg) {
        try { fs.unlinkSync(f.path); } catch (_) {}
        return res.status(400).json({ error: 'SVG images are not allowed.' });
      }
      if (!isJpeg && !isPng) {
        try { fs.unlinkSync(f.path); } catch (_) {}
        return res.status(400).json({ error: 'Invalid image format. Use JPG or PNG.' });
      }
    } catch (_) {
      return res.status(400).json({ error: 'Failed to read uploaded file.' });
    }
    // Re-encode to WebP with randomized filename
    let storedPath = f.path;
    try {
      if (sharp) {
        const base = crypto.randomBytes(8).toString('hex');
        const outDir = path.dirname(f.path);
        const webpPath = path.join(outDir, `${base}.webp`);
        await sharp(f.path).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 85 }).toFile(webpPath);
        try { fs.unlinkSync(f.path); } catch (_) {}
        storedPath = webpPath;
      }
    } catch (_) {}
    db.prepare(`INSERT INTO banners (path, active, sort_order, created_at) VALUES (?, 1, 0, ?)`)
      .run(storedPath, new Date().toISOString());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to upload banner' });
  }
});

router.post('/banners/:id/active', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { active } = req.body || {};
  try {
    db.prepare(`UPDATE banners SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

router.delete('/banners/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  try {
    const row = db.prepare(`SELECT path FROM banners WHERE id = ?`).get(id);
    if (row?.path) {
      try { fs.unlinkSync(row.path); } catch (_) {}
    }
    db.prepare(`DELETE FROM banners WHERE id = ?`).run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

/**
 * Secure Config File (encrypted at rest)
 * - File stored at data/secure-config.enc
 * - Symmetric encryption with AES-256-GCM (key derived via scrypt from passphrase)
 * - Only accessible via admin endpoints with passphrase provided per request
 * - Server does NOT store the passphrase
 */
const secureConfigPath = path.resolve(process.cwd(), 'data', 'secure-config.enc');

function deriveKey(pass) {
  const salt = crypto.createHash('sha256').update('ganudenu-config-salt').digest();
  return crypto.scryptSync(String(pass), salt, 32);
}

function encryptConfig(pass, jsonString) {
  const iv = crypto.randomBytes(12);
  const key = deriveKey(pass);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(jsonString, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store IV + TAG + CIPHERTEXT as base64
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

function decryptConfig(pass, b64) {
  const buf = Buffer.from(String(b64), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const key = deriveKey(pass);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

// Status/meta endpoint (admin authenticated)
router.get('/config-secure/status', requireAdmin, (req, res) => {
  try {
    const exists = fs.existsSync(secureConfigPath);
    if (!exists) return res.json({ exists: false });
    const stat = fs.statSync(secureConfigPath);
    return res.json({ exists: true, size: stat.size, mtime: stat.mtime.toISOString() });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to get status' });
  }
});

// Decrypt and read (requires passphrase)
router.post('/config-secure/decrypt', requireAdmin, (req, res) => {
  const { passphrase } = req.body || {};
  if (!passphrase) return res.status(400).json({ error: 'passphrase required' });
  try {
    if (!fs.existsSync(secureConfigPath)) return res.status(404).json({ error: 'Config not found' });
    const b64 = fs.readFileSync(secureConfigPath, 'utf8');
    const json = decryptConfig(passphrase, b64);
    // Return parsed JSON if possible
    try {
      return res.json({ ok: true, config: JSON.parse(json) });
    } catch (_) {
      return res.json({ ok: true, config_text: json });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid passphrase or corrupted config' });
  }
});

// Encrypt and write (requires passphrase). Creates or overwrites the file.
router.post('/config-secure/encrypt', requireAdmin, (req, res) => {
  const { passphrase, config } = req.body || {};
  if (!passphrase) return res.status(400).json({ error: 'passphrase required' });
  if (config == null) return res.status(400).json({ error: 'config required' });
  try {
    const jsonString = typeof config === 'string' ? config : JSON.stringify(config, null, 2);
    const b64 = encryptConfig(passphrase, jsonString);
    fs.mkdirSync(path.dirname(secureConfigPath), { recursive: true });
    fs.writeFileSync(secureConfigPath, b64, 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to write secure config' });
  }
});

// Notifications management (admin)
router.get('/notifications', requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, title, message, target_email, created_at
      FROM notifications
      ORDER BY id DESC
      LIMIT 200
    `).all();
    res.json({ results: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.post('/notifications', requireAdmin, async (req, res) => {
  const { title, message, targetEmail, sendEmail: sendEmailFlag } = req.body || {};
  if (!title || !message) {
    return res.status(400).json({ error: 'title and message are required' });
  }

  // Optional email delivery to a specific user (only if explicitly requested)
  if (targetEmail && sendEmailFlag) {
    try {
      const to = String(targetEmail).toLowerCase().trim();
      if (to) {
        const html = `<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
          <h2 style="margin:0 0 10px 0;">${String(title).trim()}</h2>
          <div>${String(message).trim().replace(/\\n/g, '<br/>')}</div>
        </div>`;
        const sent = await sendEmail(to, String(title).trim(), html);
        if (!sent?.ok) {
          // Continue with in-app notification even if email fails
          console.warn('[admin:notifications] email send failed:', sent?.error || sent);
        }
      }
    } catch (e) {
      console.warn('[admin:notifications] email error:', e && e.message ? e.message : e);
      // Do not fail the request; still create in-app notification
    }
  }

  try {
    db.prepare(`
      INSERT INTO notifications (title, message, target_email, created_at)
      VALUES (?, ?, ?, ?)
    `).run(
      String(title).trim(),
      String(message).trim(),
      targetEmail ? String(targetEmail).toLowerCase().trim() : null,
      new Date().toISOString()
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

router.delete('/notifications/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM notification_reads WHERE notification_id = ?`).run(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// --- Admin listing management ---

// Get all listings for a specific user (by user id)
router.get('/users/:id/listings', requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user id' });
  try {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user?.email) return res.status(404).json({ error: 'User not found' });
    const rows = db.prepare(`
      SELECT id, main_category, title, location, price, status, thumbnail_path, created_at, is_urgent
      FROM listings
      WHERE LOWER(owner_email) = LOWER(?)
      ORDER BY created_at DESC
      LIMIT 300
    `).all(String(user.email).toLowerCase().trim());
    function filePathToUrl(p) {
      if (!p) return null;
      const filename = String(p).split(/[\\/]/).pop();
      return filename ? '/uploads/' + filename : null;
    }
    const results = rows.map(r => ({
      ...r,
      thumbnail_url: filePathToUrl(r.thumbnail_path),
      urgent: !!r.is_urgent,
      is_urgent: !!r.is_urgent
    }));
    res.json({ results, user: { id: userId, email: user.email } });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load user listings' });
  }
});

// Set or clear urgent flag for a listing
router.post('/listings/:id/urgent', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const urgent = !!req.body?.urgent;
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id' });
  try {
    db.prepare('UPDATE listings SET is_urgent = ? WHERE id = ?').run(urgent ? 1 : 0, id);
    db.prepare('INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, ?, ?)').run(
      req.admin.id,
      id,
      urgent ? 'urgent_on' : 'urgent_off',
      new Date().toISOString()
    );
    res.json({ ok: true, urgent });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update urgent flag' });
  }
});

// Delete a listing (admin override; removes images and related rows)
router.delete('/listings/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid listing id' });
  try {
    const listing = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Delete associated images first
    const images = db.prepare('SELECT path, medium_path FROM listing_images WHERE listing_id = ?').all(id);
    for (const img of images) {
      if (img?.path) { try { fs.unlinkSync(img.path); } catch (_) {} }
      if (img?.medium_path) { try { fs.unlinkSync(img.medium_path); } catch (_) {} }
    }
    // Delete generated variants
    if (listing.thumbnail_path) { try { fs.unlinkSync(listing.thumbnail_path); } catch (_) {} }
    if (listing.medium_path) { try { fs.unlinkSync(listing.medium_path); } catch (_) {} }
    if (listing.og_image_path) { try { fs.unlinkSync(listing.og_image_path); } catch (_) {} }

    // Remove DB rows in correct order
    db.prepare('DELETE FROM listing_images WHERE listing_id = ?').run(id);
    db.prepare('DELETE FROM reports WHERE listing_id = ?').run(id);
    db.prepare('DELETE FROM notifications WHERE listing_id = ?').run(id);
    db.prepare('DELETE FROM listings WHERE id = ?').run(id);

    db.prepare('INSERT INTO admin_actions (admin_id, listing_id, action, ts) VALUES (?, ?, ?, ?)').run(
      req.admin.id,
      id,
      'delete_listing',
      new Date().toISOString()
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete listing' });
  }
});

// --- Backup and Restore (Full Website) ---
// Create a ZIP backup containing a consistent snapshot of the database + uploads + secure config.
// Returns the ZIP file directly as a download response.
router.post('/backup', requireAdmin, (req, res) => {
  try {
    const dataDir = path.resolve(process.cwd(), 'data');
    const uploadsDir = path.join(dataDir, 'uploads');

    // Create a consistent DB snapshot using SQLite VACUUM INTO. Fallback to direct copy if unavailable.
    const snapshotPath = path.join(dataDir, `snapshot-${Date.now()}.sqlite`);
    try { fs.unlinkSync(snapshotPath); } catch (_) {}
    try {
      const quoted = snapshotPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${quoted}'`);
    } catch (_) {
      // Fallback: direct copy of the DB (may not be perfectly consistent under write load, but acceptable as fallback)
      try {
        const dbFile = path.join(dataDir, 'ganudenu.sqlite');
        fs.copyFileSync(dbFile, snapshotPath);
      } catch (e2) {
        return res.status(500).json({ error: 'Failed to create database snapshot' });
      }
    }

    const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
    const filename = `ganudenu-backup-${ts}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      try { fs.unlinkSync(snapshotPath); } catch (_) {}
      // If headers already sent, end the stream
      if (!res.headersSent) res.status(500);
      res.end();
    });

    // When finished writing, clean up the snapshot file
    res.on('finish', () => { try { fs.unlinkSync(snapshotPath); } catch (_) {} });
    res.on('close', () => { try { fs.unlinkSync(snapshotPath); } catch (_) {} });

    archive.pipe(res);

    // Include DB snapshot as ganudenu.sqlite
    if (fs.existsSync(snapshotPath)) {
      archive.file(snapshotPath, { name: 'ganudenu.sqlite' });
    }

    // Include uploads directory (images, thumbnails, etc.)
    if (fs.existsSync(uploadsDir)) {
      archive.directory(uploadsDir, 'uploads');
    }

    // Include secure config if present
    const secureConfigPath = path.resolve(process.cwd(), 'data', 'secure-config.enc');
    if (fs.existsSync(secureConfigPath)) {
      archive.file(secureConfigPath, { name: 'secure-config.enc' });
    }

    // Include AI temp extracts if present (optional but useful)
    const tmpAiDir = path.resolve(process.cwd(), 'data', 'tmp_ai');
    if (fs.existsSync(tmpAiDir)) {
      archive.directory(tmpAiDir, 'tmp_ai');
    }

    // Basic metadata
    const meta = JSON.stringify({
      created_at: new Date().toISOString(),
      db_snapshot_size: (() => { try { return fs.statSync(snapshotPath).size; } catch (_) { return null; } })()
    }, null, 2);
    archive.append(meta, { name: 'meta.json' });

    archive.finalize();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Restore from a ZIP backup. This will:
// - Replace the entire database content by copying schema + data from backup DB into current DB.
// - Merge uploads from the backup into the current uploads directory (overwrites when filenames collide).
// - Restore secure-config.enc if present.
// Note: Performs the operation within a transaction with foreign_keys disabled. Other requests may be blocked briefly.
const tmpRestoreDir = path.resolve(process.cwd(), 'data', 'tmp_restore');
if (!fs.existsSync(tmpRestoreDir)) fs.mkdirSync(tmpRestoreDir, { recursive: true });
const backupUpload = multer({
  dest: tmpRestoreDir,
  limits: { files: 1, fileSize: 500 * 1024 * 1024 } // up to 500MB
});

function copyDirRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const s = path.join(src, entry);
    const d = path.join(dest, entry);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) {
      copyDirRecursiveSync(s, d);
    } else if (stat.isFile()) {
      try {
        fs.copyFileSync(s, d);
      } catch (_) {}
    }
  }
}

router.post('/restore', requireAdmin2FA, backupUpload.single('backup'), async (req, res) => {
  try {
    const f = req.file;
    if (!f) return res.status(400).json({ error: 'Backup file (ZIP) required' });

    // Basic ZIP signature check (PK\x03\x04)
    try {
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      const isZip = buf[0] === 0x50 && buf[1] === 0x4B && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07) && (buf[3] === 0x04 || buf[3] === 0x06 || buf[3] === 0x08);
      if (!isZip) {
        try { fs.unlinkSync(f.path); } catch (_) {}
        return res.status(400).json({ error: 'Invalid backup format. Please upload a .zip file.' });
      }
    } catch (_) {
      // continue; we'll try to extract anyway
    }

    // Extract ZIP to a new temp directory with zip-slip protection and whitelist
    const extractDir = path.join(tmpRestoreDir, `extracted-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      const zip = new AdmZip(f.path);
      const entries = zip.getEntries();
      const allowTop = new Set(['ganudenu.sqlite', 'secure-config.enc', 'uploads/', 'data/', 'tmp_ai/']);
      for (const entry of entries) {
        const name = String(entry.entryName || '');
        // Normalize using POSIX separators
        const norm = name.replace(/\\/g, '/');
        // Disallow absolute paths and parent traversals
        if (norm.startsWith('/') || norm.includes('..')) {
          continue;
        }
        // Whitelist expected roots
        const allowed = [...allowTop].some(prefix => norm === prefix || norm.startsWith(prefix));
        if (!allowed) continue;

        // Compute destination
        const destPath = path.join(extractDir, norm);
        const destDir = path.dirname(destPath);
        fs.mkdirSync(destDir, { recursive: true });

        if (entry.isDirectory) {
          fs.mkdirSync(destPath, { recursive: true });
        } else {
          const data = entry.getData();
          fs.writeFileSync(destPath, data);
        }
      }
    } catch (e) {
      try { fs.unlinkSync(f.path); } catch (_) {}
      return res.status(400).json({ error: 'Failed to extract backup ZIP safely' });
    } finally {
      try { fs.unlinkSync(f.path); } catch (_) {}
    }

    const dataDir = path.resolve(process.cwd(), 'data');
    const restoreDbPath = path.join(extractDir, 'ganudenu.sqlite');
    if (!fs.existsSync(restoreDbPath)) {
      // Some backups might store DB under data/ganudenu.sqlite
      const altPath = path.join(extractDir, 'data', 'ganudenu.sqlite');
      if (fs.existsSync(altPath)) {
        try { fs.renameSync(altPath, restoreDbPath); } catch (_) {}
      }
    }
    if (!fs.existsSync(restoreDbPath)) {
      // Cleanup extraction dir
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
      return res.status(400).json({ error: 'Backup is missing ganudenu.sqlite' });
    }

    // Attach backup DB and copy schema + data into main
    const quoted = restoreDbPath.replace(/'/g, "''");
    try {
      db.exec(`PRAGMA foreign_keys = OFF`);
      db.exec(`BEGIN EXCLUSIVE`);
      db.exec(`ATTACH DATABASE '${quoted}' AS restore`);

      // Drop existing tables, indexes, triggers in main
      const mainTables = db.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
      for (const t of mainTables) {
        const name = String(t.name);
        if (!name) continue;
        try { db.exec(`DROP TABLE IF EXISTS "${name}"`); } catch (_) {}
      }
      const mainIndexes = db.prepare(`SELECT name FROM sqlite_schema WHERE type='index' AND name NOT LIKE 'sqlite_%'`).all();
      for (const idx of mainIndexes) {
        const name = String(idx.name);
        if (!name) continue;
        try { db.exec(`DROP INDEX IF EXISTS "${name}"`); } catch (_) {}
      }
      const mainTriggers = db.prepare(`SELECT name FROM sqlite_schema WHERE type='trigger'`).all();
      for (const tr of mainTriggers) {
        const name = String(tr.name);
        if (!name) continue;
        try { db.exec(`DROP TRIGGER IF EXISTS "${name}"`); } catch (_) {}
      }

      // Recreate tables from restore schema
      const restoreTables = db.prepare(`SELECT name, sql FROM restore.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();
      for (const t of restoreTables) {
        const createSql = String(t.sql || '').trim();
        const name = String(t.name || '').trim();
        if (!createSql || !name) continue;
        db.exec(createSql);
      }
      // Copy data for each table
      for (const t of restoreTables) {
        const name = String(t.name || '').trim();
        if (!name) continue;
        try {
          db.exec(`INSERT INTO "${name}" SELECT * FROM restore."${name}"`);
        } catch (_) {
          // if columns mismatch, skip
        }
      }

      // Recreate indexes
      const restoreIndexes = db.prepare(`SELECT name, sql FROM restore.sqlite_schema WHERE type='index' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`).all();
      for (const idx of restoreIndexes) {
        const sql = String(idx.sql || '').trim();
        if (!sql) continue;
        try { db.exec(sql); } catch (_) {}
      }

      // Recreate triggers
      const restoreTriggers = db.prepare(`SELECT name, sql FROM restore.sqlite_schema WHERE type='trigger' AND sql IS NOT NULL`).all();
      for (const tr of restoreTriggers) {
        const sql = String(tr.sql || '').trim();
        if (!sql) continue;
        try { db.exec(sql); } catch (_) {}
      }

      db.exec(`DETACH DATABASE restore`);
      db.exec(`COMMIT`);
      db.exec(`PRAGMA foreign_keys = ON`);
    } catch (e) {
      try { db.exec(`ROLLBACK`); } catch (_) {}
      try { db.exec(`PRAGMA foreign_keys = ON`); } catch (_) {}
      // Cleanup extraction dir
      try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
      return res.status(500).json({ error: 'Failed to restore database from backup' });
    }

    // Restore uploads (merge/overwrite collisions) - only within uploads folder
    try {
      const backupUploads = path.join(extractDir, 'uploads');
      if (fs.existsSync(backupUploads)) {
        const destUploads = path.join(dataDir, 'uploads');
        fs.mkdirSync(destUploads, { recursive: true });
        copyDirRecursiveSync(backupUploads, destUploads);
      }
    } catch (_) {}

    // Restore secure config if present
    try {
      const backupSecure = path.join(extractDir, 'secure-config.enc');
      if (fs.existsSync(backupSecure)) {
        const destSecure = path.resolve(process.cwd(), 'data', 'secure-config.enc');
        fs.copyFileSync(backupSecure, destSecure);
      }
    } catch (_) {}

    // Cleanup extraction dir
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to restore from backup' });
  }
});

// Explicit maintenance endpoints
router.get('/maintenance', requireAdmin, (req, res) => {
  try {
    const row = db.prepare('SELECT maintenance_mode, maintenance_message FROM admin_config WHERE id = 1').get();
    res.json({ enabled: !!(row && row.maintenance_mode), message: row?.maintenance_message || '' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to load maintenance state' });
  }
});

router.post('/maintenance', requireAdmin, (req, res) => {
  const { enabled, message } = req.body || {};
  try {
    const row = db.prepare('SELECT id FROM admin_config WHERE id = 1').get();
    if (!row) db.prepare('INSERT INTO admin_config (id) VALUES (1)').run();
    db.prepare('UPDATE admin_config SET maintenance_mode = ?, maintenance_message = COALESCE(?, maintenance_message) WHERE id = 1')
      .run(enabled ? 1 : 0, message != null ? String(message).trim() : null);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update maintenance state' });
  }
});

export default router;
