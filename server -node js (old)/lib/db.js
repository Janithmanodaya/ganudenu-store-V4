import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'ganudenu.sqlite');
export const db = new Database(dbPath, { fileMustExist: false });

// Pragmas for stability and integrity
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

/**
 * Ensure core tables that other modules assume exist at import-time.
 * This must run here so route modules that call PRAGMA/ALTER on these tables don't fail.
 */
try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      main_category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      structured_json TEXT,
      seo_title TEXT,
      seo_description TEXT,
      seo_keywords TEXT,
      seo_json TEXT,
      location TEXT,
      price REAL,
      pricing_type TEXT,
      phone TEXT,
      owner_email TEXT,
      thumbnail_path TEXT,
      medium_path TEXT,
      og_image_path TEXT,
      facebook_post_url TEXT,
      valid_until TEXT,
      status TEXT NOT NULL DEFAULT 'Pending Approval',
      created_at TEXT NOT NULL,
      model_name TEXT,
      manufacture_year INTEGER,
      reject_reason TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      is_urgent INTEGER NOT NULL DEFAULT 0,
      remark_number TEXT
    )
  `).run();
} catch (_) {}