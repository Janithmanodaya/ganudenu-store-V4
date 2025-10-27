import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const baseDir = path.resolve(process.cwd(), 'data', 'tmp_ai');
if (!fs.existsSync(baseDir)) {
  fs.mkdirSync(baseDir, { recursive: true });
}

function emailKey(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  return crypto.createHash('sha1').update(e).digest('hex');
}

function dbPathForEmail(email) {
  const key = emailKey(email);
  if (!key) return null;
  return path.join(baseDir, key + '.sqlite');
}

export function openUserTempDb(email) {
  const p = dbPathForEmail(email);
  if (!p) return null;
  const db = new Database(p, { fileMustExist: false });
  // light pragmas
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  } catch (_) {}

  db.prepare(`
    CREATE TABLE IF NOT EXISTS ai_extracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_id INTEGER,
      created_at TEXT NOT NULL,
      location TEXT,
      price REAL,
      pricing_type TEXT,
      phone TEXT,
      model_name TEXT,
      manufacture_year INTEGER,
      sub_category TEXT,
      raw_json TEXT
    )
  `).run();

  // Ensure new columns exist for older temp DBs
  try {
    const cols = db.prepare(`PRAGMA table_info(ai_extracts)`).all();
    const names = new Set(cols.map(c => c.name));
    if (!names.has('model_name')) db.prepare(`ALTER TABLE ai_extracts ADD COLUMN model_name TEXT`).run();
    if (!names.has('manufacture_year')) db.prepare(`ALTER TABLE ai_extracts ADD COLUMN manufacture_year INTEGER`).run();
    if (!names.has('sub_category')) db.prepare(`ALTER TABLE ai_extracts ADD COLUMN sub_category TEXT`).run();
  } catch (_) {}

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_extracts_draft ON ai_extracts(draft_id)`).run();

  return db;
}

export function writeExtract(email, draftId, data) {
  const db = openUserTempDb(email);
  if (!db) return;
  const payload = {
    location: data?.location ?? null,
    price: data?.price ?? null,
    pricing_type: data?.pricing_type ?? null,
    phone: data?.phone ?? null,
    model_name: data?.model_name ?? null,
    manufacture_year: data?.manufacture_year ?? null,
    sub_category: data?.sub_category ?? null,
    raw_json: (() => { try { return JSON.stringify(data || {}); } catch (_) { return null; } })(),
  };
  db.prepare(`
    INSERT INTO ai_extracts (draft_id, created_at, location, price, pricing_type, phone, model_name, manufacture_year, sub_category, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    Number(draftId) || null,
    new Date().toISOString(),
    payload.location,
    payload.price,
    payload.pricing_type,
    payload.phone,
    payload.model_name,
    payload.manufacture_year,
    payload.sub_category,
    payload.raw_json
  );
}

export function readExtract(email, draftId) {
  console.log(`[tmpdb] readExtract called for email: ${email}, draftId: ${draftId}`);
  try {
    const db = openUserTempDb(email);
    if (!db) {
      console.warn(`[tmpdb] No temp DB available for email: ${email}`);
      return null;
    }

    const idNum = draftId != null ? Number(draftId) : null;
    let row = null;

    if (idNum != null && Number.isFinite(idNum)) {
      console.log(`[tmpdb] Attemping to find extract with draft_id: ${idNum}`);
      row = db.prepare(`SELECT * FROM ai_extracts WHERE draft_id = ? ORDER BY id DESC LIMIT 1`).get(idNum);
      if (row) {
        console.log(`[tmpdb] Found extract for draft_id: ${idNum}`);
      } else {
        console.warn(`[tmpdb] No extract found for specific draft_id: ${idNum} for email: ${email}.`);
      }
    } else {
      console.log(`[tmpdb] No valid draftId provided. Fetching latest extract for email: ${email}`);
      row = db.prepare(`SELECT * FROM ai_extracts ORDER BY id DESC LIMIT 1`).get();
      if (row) {
        console.log(`[tmpdb] Found latest extract for email: ${email} with id: ${row.id}`);
      }
    }

    if (!row) {
      console.warn(`[tmpdb] No extract rows found for email: ${email}, draftId: ${draftId}`);
      return null;
    }

    console.log(`[tmpdb] Successfully retrieved row, preparing to return data.`);
    return {
      location: row.location ?? null,
      price: typeof row.price === 'number' ? row.price : (row.price != null ? Number(row.price) : null),
      pricing_type: row.pricing_type ?? null,
      phone: row.phone ?? null,
      model_name: row.model_name ?? null,
      manufacture_year: row.manufacture_year != null ? Number(row.manufacture_year) : null,
      sub_category: row.sub_category ?? null,
      raw_json: row.raw_json || null
    };
  } catch (e) {
    console.error(`[tmpdb] Failed to read extract for email: ${email}, draftId: ${draftId}, error: ${e && e.message ? e.message : e}`);
    return null;
  }
}

export function deleteUserTempDb(email) {
  const p = dbPathForEmail(email);
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) {}
}
