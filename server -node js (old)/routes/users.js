import { Router } from 'express';
import { db } from '../lib/db.js';

const router = Router();

// Ensure tables for seller profiles and ratings
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS seller_profiles (
      user_email TEXT PRIMARY KEY,
      bio TEXT,
      verified_email INTEGER NOT NULL DEFAULT 0,
      verified_phone INTEGER NOT NULL DEFAULT 0,
      rating_avg REAL NOT NULL DEFAULT 0,
      rating_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS seller_ratings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_email TEXT NOT NULL,
      rater_email TEXT NOT NULL,
      listing_id INTEGER,
      stars INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT NOT NULL
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_seller_ratings_seller ON seller_ratings(seller_email)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_seller_ratings_rater ON seller_ratings(rater_email)`).run();
} catch (_) {}

// Helper: fetch user by username or email
function findUser({ username, email }) {
  if (username) {
    const u = db.prepare(`SELECT id, email, username, profile_photo_path FROM users WHERE LOWER(username) = LOWER(?)`).get(username);
    if (u) return u;
    // Fallback: if the "username" looks like an email or username not found, try as email
    const maybeEmail = String(username || '').toLowerCase();
    const hasAt = maybeEmail.includes('@');
    if (hasAt) {
      const ue = db.prepare(`SELECT id, email, username, profile_photo_path FROM users WHERE LOWER(email) = LOWER(?)`).get(maybeEmail);
      if (ue) return ue;
    }
  }
  if (email) {
    return db.prepare(`SELECT id, email, username, profile_photo_path FROM users WHERE LOWER(email) = LOWER(?)`).get(email);
  }
  return null;
}

// Public: get seller profile by username (or email via query)
router.get('/profile', (req, res) => {
  try {
    const handle = String(req.query.username || req.query.email || '').trim().toLowerCase();
    const user = findUser({ username: handle, email: handle });
    if (!user) return res.status(404).json({ error: 'Seller not found' });

    const photo_url = user.profile_photo_path ? ('/uploads/' + (user.profile_photo_path.split('/').pop())) : null;
    const profile = db.prepare(`SELECT * FROM seller_profiles WHERE LOWER(user_email) = LOWER(?)`).get(user.email) || {
      user_email: user.email, bio: '', verified_email: 0, verified_phone: 0, rating_avg: 0, rating_count: 0, updated_at: null
    };

    const nowIso = new Date().toISOString();
    const stats = db.prepare(`
      SELECT
        (
          SELECT COUNT(*)
          FROM listings
          WHERE LOWER(owner_email) = LOWER(?)
            AND status = 'Approved'
            AND (valid_until IS NULL OR valid_until > ?)
        ) AS active_listings,
        (
          SELECT COUNT(*)
          FROM seller_ratings
          WHERE LOWER(seller_email) = LOWER(?)
        ) AS ratings_count
    `).get(user.email, nowIso, user.email);

    const ratings = db.prepare(`
      SELECT sr.id, u.id AS rater_id, sr.listing_id, sr.stars, sr.comment, sr.created_at
      FROM seller_ratings sr
      LEFT JOIN users u ON LOWER(u.email) = LOWER(sr.rater_email)
      WHERE LOWER(sr.seller_email) = LOWER(?)
      ORDER BY sr.id DESC
    `).all(user.email);

    return res.json({
      ok: true,
      user: { email: user.email, username: user.username, photo_url },
      profile,
      stats,
      ratings
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Auth gate via header
function requireUser(req, res, next) {
  const email = String(req.header('X-User-Email') || '').toLowerCase().trim();
  if (!email) return res.status(401).json({ error: 'Missing user email' });
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Invalid user' });
  req.user = { email, id: user.id };
  next();
}

// Upsert profile (owner only)
router.post('/profile', requireUser, (req, res) => {
  try {
    const bio = String(req.body?.bio || '').trim();
    const verified_email = req.body?.verified_email ? 1 : 0;
    const verified_phone = req.body?.verified_phone ? 1 : 0;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO seller_profiles (user_email, bio, verified_email, verified_phone, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_email) DO UPDATE SET bio=excluded.bio, verified_email=excluded.verified_email, verified_phone=excluded.verified_phone, updated_at=excluded.updated_at
    `).run(req.user.email, bio, verified_email, verified_phone, now);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Add rating (requires logged-in rater; cannot rate self)
router.post('/rate', requireUser, (req, res) => {
  try {
    const { seller_email, listing_id, stars, comment } = req.body || {};
    const seller = String(seller_email || '').toLowerCase().trim();
    const rater = req.user.email;
    if (!seller || seller === rater) return res.status(400).json({ error: 'Invalid seller' });
    const s = Number(stars);
    if (!Number.isFinite(s) || s < 1 || s > 5) return res.status(400).json({ error: 'Stars must be 1-5' });

    // Enforce one review per rater per seller
    const existing = db.prepare(`SELECT id FROM seller_ratings WHERE LOWER(seller_email) = LOWER(?) AND LOWER(rater_email) = LOWER(?) LIMIT 1`).get(seller, rater);
    if (existing) {
      return res.status(409).json({ error: 'You have already rated this seller.' });
    }

    db.prepare(`
      INSERT INTO seller_ratings (seller_email, rater_email, listing_id, stars, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(seller, rater, listing_id ? Number(listing_id) : null, Math.round(s), String(comment || '').trim(), new Date().toISOString());

    // Recompute aggregate
    const agg = db.prepare(`SELECT AVG(stars) as avg, COUNT(*) as cnt FROM seller_ratings WHERE LOWER(seller_email) = LOWER(?)`).get(seller);
    db.prepare(`
      INSERT INTO seller_profiles (user_email, rating_avg, rating_count, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_email) DO UPDATE SET rating_avg=excluded.rating_avg, rating_count=excluded.rating_count, updated_at=excluded.updated_at
    `).run(seller, Number(agg.avg || 0).toFixed(2), agg.cnt || 0, new Date().toISOString());

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to add rating' });
  }
});

export default router;