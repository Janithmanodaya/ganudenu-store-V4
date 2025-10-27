import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { db } from '../lib/db.js';

const router = Router();

const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 5 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => {
    const mt = String(file.mimetype || '');
    if (!mt.startsWith('image/')) return cb(new Error('Only images are allowed'));
    if (mt === 'image/svg+xml') return cb(new Error('SVG images are not allowed'));
    cb(null, true);
  }
});

// Ensure schema columns for employee profiles
try {
  const colsDraft = db.prepare('PRAGMA table_info(listing_drafts)').all();
  if (!colsDraft.find(c => c.name === 'employee_profile')) {
    db.prepare('ALTER TABLE listing_drafts ADD COLUMN employee_profile INTEGER DEFAULT 0').run();
  }
  const colsList = db.prepare('PRAGMA table_info(listings)').all();
  if (!colsList.find(c => c.name === 'employee_profile')) {
    db.prepare('ALTER TABLE listings ADD COLUMN employee_profile INTEGER DEFAULT 0').run();
  }
} catch (_) {}

// Post Employee Profile draft (manual input; images optional)
router.post('/employee/draft', upload.array('images', 2), async (req, res) => {
  try {
    const files = req.files || [];
    const { name, target_title, summary, location, phone, sub_category, sub_category_custom } = req.body || {};
    const ownerEmail = String(req.header('X-User-Email') || '').toLowerCase().trim();

    if (!ownerEmail) return res.status(400).json({ error: 'Missing user email' });
    if (!name || !target_title || !summary) {
      return res.status(400).json({ error: 'name, target_title, and summary are required.' });
    }
    if (String(name).length > 120 || String(target_title).length > 120) {
      return res.status(400).json({ error: 'Name/Target Title too long.' });
    }
    if (String(summary).length < 10 || String(summary).length > 5000) {
      return res.status(400).json({ error: 'Summary must be between 10 and 5000 characters.' });
    }

    // Manual required fields for Job category
    const loc = String(location || '').trim();
    const ph = String(phone || '').trim();
    const subCustom = String(sub_category_custom || '').trim();
    let sub = String(sub_category || '').trim();
    if (!sub && subCustom) sub = subCustom;
    if (sub.toLowerCase() === 'other' && subCustom) sub = subCustom;

    if (!sub) return res.status(400).json({ error: 'Please specify a Job sub-category (e.g., Driver, IT/Software, Sales/Marketing).' });
    if (!loc) return res.status(400).json({ error: 'Location is required' });
    if (!/^\+94\d{9}$/.test(ph)) return res.status(400).json({ error: 'Phone must be in +94XXXXXXXXX format' });

    // Enforce one active employee profile per email (either existing approved or pending)
    const nowIso = new Date().toISOString();
    const existingActive = db.prepare(`
      SELECT id FROM listings
      WHERE LOWER(owner_email) = LOWER(?) AND employee_profile = 1
        AND status != 'Archived' AND (valid_until IS NULL OR valid_until > ?)
      LIMIT 1
    `).get(ownerEmail, nowIso);
    const existingDraftRow = db.prepare(`
      SELECT id FROM listing_drafts
      WHERE LOWER(owner_email) = LOWER(?) AND employee_profile = 1
      ORDER BY created_at DESC
      LIMIT 1
    `).get(ownerEmail);
    // If a live/pending profile exists, block; if a draft exists, reuse it instead of erroring
    if (existingActive && existingActive.id) {
      return res.status(400).json({ error: 'You can upload a maximum of 1 Employee Profile per email.' });
    }
    if (existingDraftRow && existingDraftRow.id) {
      return res.json({ ok: true, draftId: existingDraftRow.id, reused: true });
    }

    // Optional: convert images to webp for consistency (if provided)
    let sharp = null;
    try { sharp = (await import('sharp')).default; } catch (_) { sharp = null; }
    if (sharp && files.length) {
      for (const f of files) {
        try {
          const outDir = path.dirname(f.path);
          const baseName = path.basename(f.path, path.extname(f.path));
          const webpPath = path.join(outDir, `${baseName}-resume.webp`);
          await sharp(f.path)
            .resize({ width: 2000, withoutEnlargement: true })
            .webp({ quality: 90 })
            .toFile(webpPath);
          try { fs.unlinkSync(f.path); } catch (_) {}
          f.path = webpPath;
          try {
            const nameBase = path.basename(f.originalname, path.extname(f.originalname));
            f.originalname = `${nameBase}.webp`;
          } catch (_) {}
        } catch (e) {
          // Keep original file on failure
        }
      }
    }

    // Build structured JSON manually
    const structuredObj = {
      sub_category: sub,
      location: loc,
      phone: ph
    };
    const structuredJSON = JSON.stringify(structuredObj, null, 2);

    // Basic SEO
    const seoTitle = `${name} - ${target_title}`.slice(0, 60);
    const seoDescription = String(summary).slice(0, 160);
    const seoKeywords = `${target_title}, resume, ${name}`;
    const seoJsonBlob = JSON.stringify({ seo_title: seoTitle, meta_description: seoDescription, seo_keywords: seoKeywords }, null, 2);

    const ts = new Date().toISOString();
    const first = files[0] || null;
    const info = db.prepare(`
      INSERT INTO listing_drafts (main_category, title, description, structured_json, seo_title, seo_description, seo_keywords, seo_json, resume_file_url, owner_email, created_at, employee_profile)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      'Job',
      `${name} • ${target_title}`,
      summary,
      structuredJSON,
      seoTitle,
      seoDescription,
      seoKeywords,
      seoJsonBlob,
      first ? first.path : null,
      ownerEmail,
      ts
    );
    const draftId = info.lastInsertRowid;

    // Store images (if any) into listing_draft_images for preview/submit flow
    try {
      db.prepare(`
        CREATE TABLE IF NOT EXISTS listing_draft_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          draft_id INTEGER NOT NULL,
          path TEXT NOT NULL,
          original_name TEXT NOT NULL,
          FOREIGN KEY(draft_id) REFERENCES listing_drafts(id) ON DELETE CASCADE
        )
      `).run();
      const ins = db.prepare('INSERT INTO listing_draft_images (draft_id, path, original_name) VALUES (?, ?, ?)');
      for (const f of files) {
        try { ins.run(draftId, f.path, f.originalname || path.basename(f.path)); } catch (_) {}
      }
    } catch (_) {}

    res.json({ ok: true, draftId });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error.' });
  }
});

export default router;