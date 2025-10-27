-- Core schema for Ganudenu (parity with Node runtime)

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  username TEXT,
  profile_photo_path TEXT,
  is_banned INTEGER NOT NULL DEFAULT 0,
  suspended_until TEXT,
  user_uid TEXT UNIQUE,
  is_verified INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  gemini_api_key TEXT,
  bank_details TEXT,
  whatsapp_number TEXT,
  email_on_approve INTEGER NOT NULL DEFAULT 0,
  maintenance_mode INTEGER NOT NULL DEFAULT 0,
  maintenance_message TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  bank_name TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(username);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_user_uid_unique ON users(user_uid);

CREATE TABLE IF NOT EXISTS payment_rules (
  category TEXT PRIMARY KEY,
  amount INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

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
  remark_number TEXT,
  employee_profile INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  medium_path TEXT
);

CREATE TABLE IF NOT EXISTS listing_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  main_category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  structured_json TEXT,
  seo_title TEXT,
  seo_description TEXT,
  seo_keywords TEXT,
  seo_json TEXT,
  resume_file_url TEXT,
  owner_email TEXT,
  created_at TEXT NOT NULL,
  enhanced_description TEXT,
  wanted_tags_json TEXT,
  employee_profile INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS listing_draft_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  original_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  reporter_email TEXT,
  reason TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  ip TEXT,
  viewer_email TEXT,
  ts TEXT NOT NULL,
  UNIQUE(listing_id, ip)
);

CREATE TABLE IF NOT EXISTS listing_wanted_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  wanted_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(listing_id, wanted_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  target_email TEXT,
  created_at TEXT NOT NULL,
  type TEXT,
  listing_id INTEGER,
  meta_json TEXT,
  emailed_at TEXT
);

CREATE TABLE IF NOT EXISTS notification_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL,
  user_email TEXT NOT NULL,
  read_at TEXT NOT NULL
);

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
);

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
  created_at TEXT NOT NULL,
  locations_json TEXT,
  models_json TEXT,
  year_min INTEGER,
  year_max INTEGER,
  price_min REAL,
  price_not_matter INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  sender TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL,
  listing_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(main_category);
CREATE INDEX IF NOT EXISTS idx_listings_created ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
CREATE INDEX IF NOT EXISTS idx_listings_valid_until ON listings(valid_until);
CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_email);
CREATE INDEX IF NOT EXISTS idx_seller_ratings_seller ON chats(user_email);