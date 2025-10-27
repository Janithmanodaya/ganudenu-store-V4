import { db } from './lib/db.js';

// Create default admin user for initial access if ADMIN_EMAIL and ADMIN_CODE are set
const adminEmail = process.env.ADMIN_EMAIL;
const adminCode = process.env.ADMIN_CODE;

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    username TEXT,
    user_uid TEXT UNIQUE,
    is_verified INTEGER NOT NULL DEFAULT 0
  )
`).run();

// Ensure indexes/columns exist if upgrading from older schema
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
  const hasUserUID = cols.some(c => c.name === 'user_uid');
  if (!hasUserUID) {
    db.prepare(`ALTER TABLE users ADD COLUMN user_uid TEXT`).run();
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_uid_unique ON users(user_uid)`).run();
  }
  const hasVerified = cols.some(c => c.name === 'is_verified');
  if (!hasVerified) {
    db.prepare(`ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0`).run();
  }
} catch (_) {}

db.prepare(`
  CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    gemini_api_key TEXT
  )
`).run();

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

const existingConfig = db.prepare('SELECT id FROM admin_config WHERE id = 1').get();
if (!existingConfig) {
  db.prepare('INSERT INTO admin_config (id, gemini_api_key) VALUES (1, NULL)').run();
}

// Seed default prompts if they don't exist
const prompts = [
  {
    type: 'listing_extraction',
    content: `Extract key details from this listing. Respond with ONLY a valid JSON object.

Schema:
{
  "location": "string (city or district)",
  "price": "number (omit commas/symbols)",
  "pricing_type": "'Fixed Price' or 'Negotiable'",
  "phone": "string (format: +94XXXXXXXXX)",
  "model_name": "string (e.g., 'Honda Civic')",
  "manufacture_year": "number (e.g., 2020)"
}

- Location: Infer the main city or district.
- Price: Extract only the numerical value.
- Phone: Find the seller's phone number and format it.
- Model Name: Identify the make and model.
- Manufacture Year: Find the year the item was made.

If a value is not found, use an empty string "" for text fields or null for numbers.`
  },
  {
    type: 'seo_metadata',
    content: `Generate SEO metadata for a listing. Respond with ONLY a valid JSON object.

Schema:
{
  "seo_title": "string (max 60 chars)",
  "seo_description": "string (max 160 chars)",
  "seo_keywords": "array of strings (5-10 keywords)"
}

- Title: Compelling and relevant to the listing.
- Description: Summarize the key features and benefits.
- Keywords: Include brand, model, location, and synonyms.`
  },
  {
    type: 'description_enhancement',
    content: `Rewrite and enhance this listing description. Make it clear, appealing, and easy to read. Use professional but friendly language. Add 2-3 relevant emojis. Return only the enhanced text.`
  }
];

const insertPrompt = db.prepare('INSERT OR IGNORE INTO prompts (type, content) VALUES (?, ?)');
for (const p of prompts) {
  insertPrompt.run(p.type, p.content);
}

if (adminEmail && adminCode) {
  // Set a default password equal to ADMIN_CODE for initial login
  console.log('Admin bootstrap: Please register manually via /api/auth/register with adminCode.');
} else {
  console.log('DB initialized.');
}
