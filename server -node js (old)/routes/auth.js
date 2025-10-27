import express, { Router } from 'express';
import { db } from '../lib/db.js';
import bcrypt from 'bcrypt';
import { generateOtp, sendEmail, generateUserUID } from '../lib/utils.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { signToken, requireUser, getBearerToken, verifyTokenRaw } from '../lib/auth.js';

const router = Router();

// Cookie options helper to ensure proper attributes across environments
function getAuthCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const domainUrl = String(process.env.PUBLIC_ORIGIN || process.env.PUBLIC_DOMAIN || '').trim();
  let cookieDomain = '';
  try { cookieDomain = domainUrl ? new URL(domainUrl).hostname : ''; } catch (_) { cookieDomain = ''; }
  // If domain not provided, leave unset to default to current host
  const base = {
    httpOnly: true,
    secure: isProd,           // Secure cookies in production
    sameSite: 'none',         // Allow cross-site in case of subdomains
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days, matches JWT default
  };
  if (cookieDomain) base.domain = cookieDomain;
  return base;
}

// Dynamic sharp import for image processing
let sharp = null;
(async () => {
  try {
    const mod = await import('sharp');
    sharp = mod.default || mod;
  } catch (_) {
    sharp = null;
  }
})();

// Set up uploads (reuse same uploads directory)
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

// -------- Google OAuth (Authorization Code flow) --------
// Start OAuth: redirect user to Google's consent screen
router.get('/google/start', (req, res) => {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI; // e.g., https://yourdomain.com/api/auth/google/callback
    if (!clientId || !redirectUri) {
      return res.status(500).send('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_REDIRECT_URI.');
    }
    const scope = encodeURIComponent('openid email profile');
    const statePayload = {
      r: String(req.query.r || ''), // optional return URL
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');
    const url =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_type=code&scope=${scope}&prompt=select_account` +
      `&access_type=offline&state=${state}`;
    return res.redirect(url);
  } catch (e) {
    return res.status(500).send('Failed to start Google OAuth.');
  }
});

// OAuth callback: exchange code -> tokens, fetch profile, upsert user, issue JWT and redirect back to app
router.get('/google/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '');
    const stateRaw = String(req.query.state || '');
    let state = {};
    try { state = stateRaw ? JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) : {}; } catch (_) {}

    if (!code) return res.status(400).send('Missing code');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      return res.status(500).send('Google OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.');
    }

    // Token exchange
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:
        `code=${encodeURIComponent(code)}` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&client_secret=${encodeURIComponent(clientSecret)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&grant_type=authorization_code`
    });
    const tokenData = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData.id_token) {
      return res.status(502).send('Failed to exchange code with Google.');
    }

    // Get user info (decode id_token or call userinfo)
    // Prefer userinfo endpoint for freshness
    let g;
    try {
      const uResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      g = await uResp.json();
    } catch (_) {
      g = null;
    }

    // Fallback: decode id_token (naive, without verifying Google signature because we trust token endpoint)
    if (!g || !g.email) {
      try {
        const parts = String(tokenData.id_token).split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        g = { email: payload.email, email_verified: payload.email_verified, sub: payload.sub, name: payload.name };
      } catch (_) {}
    }
    const email = String(g?.email || '').toLowerCase().trim();
    const name = String(g?.name || '').trim() || email.split('@')[0];
    const sub = String(g?.sub || '').trim();
    if (!email) return res.status(400).send('Google profile missing email');

    // Upsert user (passwordless): create if not exists with random password_hash and verified=true
    let user = db.prepare('SELECT id, email, is_admin, username, user_uid, is_verified FROM users WHERE email = ?').get(email);
    if (!user) {
      const randomPass = (await import('crypto')).randomBytes(16).toString('hex');
      const hash = await bcrypt.hash(randomPass, 12);
      // Choose a username based on Google profile; ensure uniqueness
      let unameBase = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || email.split('@')[0];
      if (unameBase.length < 3) unameBase = (email.split('@')[0] || 'user').slice(0, 24);
      let uname = unameBase;
      let tries = 0;
      while (tries < 5) {
        const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(uname);
        if (!exists) break;
        uname = `${unameBase}-${Math.floor(Math.random() * 1000)}`;
        tries++;
      }
      // Generate user_uid
      let uid = generateUserUID();
      let utries = 0;
      while (utries < 3) {
        const exists = db.prepare('SELECT 1 FROM users WHERE user_uid = ?').get(uid);
        if (!exists) break;
        uid = generateUserUID();
        utries++;
      }
      const info = db.prepare('INSERT INTO users (email, password_hash, is_admin, created_at, username, user_uid, is_verified) VALUES (?, ?, 0, ?, ?, ?, 1)')
        .run(email, hash, new Date().toISOString(), uname, uid);
      user = { id: info.lastInsertRowid, email, is_admin: 0, username: uname, user_uid: uid, is_verified: 1 };
    }

    // Issue JWT and set cookie
    const token = signToken({ id: user.id, email: user.email, is_admin: !!user.is_admin });
    try {
      res.cookie('auth_token', token, getAuthCookieOptions());
    } catch (_) {}

    // Redirect back to app with token (and minimal info). The SPA will store it and fetch /api/auth/status.
    const returnUrl = state.r && /^https?:\/\//i.test(state.r) ? state.r : (process.env.PUBLIC_ORIGIN || process.env.PUBLIC_DOMAIN || '/auth');
    const url = new URL(returnUrl, returnUrl.startsWith('http') ? undefined : undefined);
    url.searchParams.set('token', token);
    url.searchParams.set('provider', 'google');
    url.searchParams.set('email', email);
    return res.redirect(url.toString());
  } catch (e) {
    return res.status(500).send('Google OAuth callback failed.');
  }
});

// Public endpoint to check if a user exists (used by UI to gate password reset)
router.get('/user-exists', (req, res) => {
  try {
    const email = String(req.query.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    return res.json({ ok: true, exists: !!existing });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Update username (requires current password)
router.post('/update-username', express.json(), async (req, res) => {
  const { email, password, username } = req.body || {};
  if (!email || !password || !username) return res.status(400).json({ error: 'Email, password and new username are required.' });
  const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  try {
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(String(username), user.id);
    return res.json({ ok: true, username });
  } catch (e) {
    if (String(e).includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username already taken.' });
    }
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Upload profile photo (requires email + password fields)
router.post('/upload-profile-photo', upload.single('photo'), async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = db.prepare('SELECT id, password_hash FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'Image file is required.' });

    // Basic file signature check + block SVG
    try {
      const fd = fs.openSync(file.path, 'r');
      const buf = Buffer.alloc(8);
      fs.readSync(fd, buf, 0, 8, 0);
      fs.closeSync(fd);
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const isSvg = String(file.mimetype || '') === 'image/svg+xml';
      if (isSvg) {
        try { fs.unlinkSync(file.path); } catch (_) {}
        return res.status(400).json({ error: 'SVG images are not allowed.' });
      }
      if (!isJpeg && !isPng) {
        try { fs.unlinkSync(file.path); } catch (_) {}
        return res.status(400).json({ error: 'Invalid image format. Use JPG or PNG.' });
      }
    } catch (_) {
      return res.status(400).json({ error: 'Failed to read uploaded file.' });
    }

    // Re-encode to WebP with randomized filename
    let storedPath = file.path;
    try {
      if (sharp) {
        const outDir = path.dirname(file.path);
        const base = (await import('crypto')).randomBytes(8).toString('hex');
        const webpPath = path.join(outDir, `${base}.webp`);
        await sharp(file.path).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 85 }).toFile(webpPath);
        try { fs.unlinkSync(file.path); } catch (_) {}
        storedPath = webpPath;
      }
    } catch (_) {
      // fallback: keep original path
    }

    db.prepare('UPDATE users SET profile_photo_path = ? WHERE id = ?').run(storedPath, user.id);
    const publicUrl = '/uploads/' + path.basename(storedPath);
    return res.json({ ok: true, photo_url: publicUrl });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Delete account (requires password)
router.post('/delete-account', express.json(), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT id, password_hash, profile_photo_path FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials.' });

  try {
    // Best-effort: delete photo file
    if (user.profile_photo_path) {
      try { fs.unlinkSync(user.profile_photo_path); } catch (_) {}
    }
    // Optionally: anonymize or transfer listings; for now just keep listings intact with owner_email
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    return res.json({ ok: true, message: 'Account deleted.' });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Send Registration OTP
router.post('/send-registration-otp', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existingUser) {
    return res.status(409).json({ error: 'Email already registered.' });
  }

  const otp = generateOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // OTP expires in 10 minutes

  try {
    const stmt = db.prepare('INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)');
    stmt.run(email.toLowerCase(), otp, expires);

    const DEV_MODE = String(process.env.EMAIL_DEV_MODE || '').toLowerCase() === 'true';
    if (DEV_MODE) {
      console.log(`[otp:dev] Registration OTP for ${email}: ${otp}`);
      return res.json({ ok: true, message: 'OTP generated (dev mode).', otp });
    }

    const sendRes = await sendEmail(email, 'Your Registration OTP', `<p>Your OTP is: <strong>${otp}</strong></p>`);
    if (!sendRes?.ok) {
      // Roll back OTP if email failed to send
      try { db.prepare('DELETE FROM otps WHERE email = ? AND otp = ?').run(email.toLowerCase(), otp); } catch (_) {}
      return res.status(502).json({ error: 'Failed to send OTP email.' });
    }

    return res.json({ ok: true, message: 'OTP sent successfully.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Registration (no admin code, requires username)
router.post('/verify-otp-and-register', async (req, res) => {
  const { email, password, otp, username } = req.body || {};
  if (!email || !password || !otp || !username) return res.status(400).json({ error: 'Email, password, username, and OTP are required.' });

  const otpRecord = db.prepare('SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC').get(email.toLowerCase(), otp);

  if (!otpRecord) {
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  const now = new Date();
  const expiresAt = new Date(otpRecord.expires_at);

  if (now > expiresAt) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.status(401).json({ error: 'OTP has expired.' });
  }

  const hashed = await bcrypt.hash(password, 12);
  try {
    // Generate a unique public UID; retry on rare collision
    let uid = generateUserUID();
    let tries = 0;
    while (tries < 3) {
      const exists = db.prepare('SELECT 1 FROM users WHERE user_uid = ?').get(uid);
      if (!exists) break;
      uid = generateUserUID();
      tries++;
    }

    const stmt = db.prepare('INSERT INTO users (email, password_hash, is_admin, created_at, username, user_uid, is_verified) VALUES (?, ?, 0, ?, ?, ?, 0)');
    const info = stmt.run(email.toLowerCase(), hashed, new Date().toISOString(), username, uid);
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);

    // Issue token for immediate authenticated use
    const token = signToken({ id: info.lastInsertRowid, email: email.toLowerCase(), is_admin: false });
    return res.json({ ok: true, token, user: { id: info.lastInsertRowid, user_uid: uid, email: email.toLowerCase(), username, is_admin: false, is_verified: false } });
  } catch (e) {
    if (String(e).includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Email or username already registered.' });
    }
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Login (now requires OTP for all users)
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT id, email, password_hash, is_admin, username, profile_photo_path, is_banned, suspended_until, user_uid, is_verified FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

  // Enforce bans and suspensions for non-admin users before sending OTP
  if (!user.is_admin) {
    if (user.is_banned) {
      return res.status(403).json({ error: 'Your account is banned. Please contact support.' });
    }
    if (user.suspended_until) {
      const now = new Date();
      const until = new Date(user.suspended_until);
      if (until > now) {
        return res.status(403).json({ error: `Your account is suspended until ${until.toLocaleString()}.` });
      }
    }
  }

  // Require OTP for all users
  try {
    const otp = generateOtp();
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)').run(user.email.toLowerCase(), otp, expires);

    const DEV_MODE = String(process.env.EMAIL_DEV_MODE || '').toLowerCase() === 'true';
    if (DEV_MODE) {
      console.log(`[otp:dev] Login OTP for ${email}: ${otp}`);
      return res.json({ ok: true, otp_required: true, is_admin: !!user.is_admin, message: 'OTP required for login (dev mode).', otp });
    }

    const subject = user.is_admin ? 'Admin Login OTP' : 'Login OTP';
    const sent = await sendEmail(user.email, subject, `<p>Your login OTP is: <strong>${otp}</strong></p>`);
    if (!sent?.ok) {
      try { db.prepare('DELETE FROM otps WHERE email = ? AND otp = ?').run(user.email.toLowerCase(), otp); } catch (_) {}
      return res.status(502).json({ error: 'Failed to send OTP email.' });
    }

    return res.json({ ok: true, otp_required: true, is_admin: !!user.is_admin, message: 'OTP sent to your email.' });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to initiate OTP.' });
  }
});

// Verify Admin Login OTP (second step)
router.post('/verify-admin-login-otp', async (req, res) => {
  const { email, password, otp } = req.body || {};
  if (!email || !password || !otp) return res.status(400).json({ error: 'Email, password, and OTP are required.' });

  const user = db.prepare('SELECT id, email, password_hash, is_admin, username, profile_photo_path, user_uid, is_verified FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !user.is_admin) return res.status(401).json({ error: 'Invalid credentials.' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

  const otpRecord = db.prepare('SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC').get(email.toLowerCase(), otp);
  if (!otpRecord) return res.status(401).json({ error: 'Invalid OTP.' });

  const now = new Date();
  const expiresAt = new Date(otpRecord.expires_at);
  if (now > expiresAt) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.status(401).json({ error: 'OTP has expired.' });
  }

  // OTP valid; consume it and log in
  try { db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id); } catch (_) {}

  // Issue admin token with MFA claim
  const token = signToken({ id: user.id, email: user.email, is_admin: true, mfa: true });
  try { res.cookie('auth_token', token, getAuthCookieOptions()); } catch (_) {}
  const photo_url = user.profile_photo_path ? ('/uploads/' + path.basename(user.profile_photo_path)) : null;
  return res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      user_uid: user.user_uid,
      email: user.email,
      username: user.username,
      is_admin: !!user.is_admin,
      is_verified: !!user.is_verified,
      photo_url
    }
  });
});

// Verify normal user Login OTP (second step)
router.post('/verify-login-otp', async (req, res) => {
  const { email, password, otp } = req.body || {};
  if (!email || !password || !otp) return res.status(400).json({ error: 'Email, password, and OTP are required.' });

  const user = db.prepare('SELECT id, email, password_hash, is_admin, username, profile_photo_path, is_banned, suspended_until, user_uid, is_verified FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials.' });

  // Enforce bans/suspension for non-admins
  if (!user.is_admin) {
    if (user.is_banned) return res.status(403).json({ error: 'Your account is banned. Please contact support.' });
    if (user.suspended_until) {
      const now = new Date();
      const until = new Date(user.suspended_until);
      if (until > now) return res.status(403).json({ error: `Your account is suspended until ${until.toLocaleString()}.` });
    }
  }

  const otpRecord = db.prepare('SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC').get(email.toLowerCase(), otp);
  if (!otpRecord) return res.status(401).json({ error: 'Invalid OTP.' });

  const now = new Date();
  const expiresAt = new Date(otpRecord.expires_at);
  if (now > expiresAt) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.status(401).json({ error: 'OTP has expired.' });
  }

  // OTP valid; consume it and log in
  try { db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id); } catch (_) {}

  // Issue normal token
  const token = signToken({ id: user.id, email: user.email, is_admin: !!user.is_admin });
  try { res.cookie('auth_token', token, getAuthCookieOptions()); } catch (_) {}
  const photo_url = user.profile_photo_path ? ('/uploads/' + path.basename(user.profile_photo_path)) : null;
  return res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      user_uid: user.user_uid,
      email: user.email,
      username: user.username,
      is_admin: !!user.is_admin,
      is_verified: !!user.is_verified,
      photo_url
    }
  });
});

// Forgot Password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) {
    // Don't reveal that the user doesn't exist
    return res.json({ ok: true, message: 'If a matching account was found, an OTP has been sent.' });
  }

  const otp = generateOtp();
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // OTP expires in 10 minutes

  try {
    const stmt = db.prepare('INSERT INTO otps (email, otp, expires_at) VALUES (?, ?, ?)');
    stmt.run(email.toLowerCase(), otp, expires);

    const DEV_MODE = String(process.env.EMAIL_DEV_MODE || '').toLowerCase() === 'true';
    if (DEV_MODE) {
      console.log(`[otp:dev] Password reset OTP for ${email}: ${otp}`);
      return res.json({ ok: true, message: 'OTP generated (dev mode).', otp });
    }

    const sendRes = await sendEmail(email, 'Your Password Reset OTP', `<p>Your OTP for password reset is: <strong>${otp}</strong></p>`);
    if (!sendRes?.ok) {
      try { db.prepare('DELETE FROM otps WHERE email = ? AND otp = ?').run(email.toLowerCase(), otp); } catch (_) {}
      // Still avoid revealing existence; but indicate failure to send
      return res.status(502).json({ error: 'Failed to send OTP email.' });
    }

    return res.json({ ok: true, message: 'If a matching account was found, an OTP has been sent.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Verify Password OTP
router.post('/verify-password-otp', async (req, res) => {
  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required.' });

  const otpRecord = db.prepare('SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC').get(email.toLowerCase(), otp);

  if (!otpRecord) {
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  const now = new Date();
  const expiresAt = new Date(otpRecord.expires_at);

  if (now > expiresAt) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.status(401).json({ error: 'OTP has expired.' });
  }

  // OTP is valid, but don't delete it yet. The user needs to reset the password.
  return res.json({ ok: true, message: 'OTP verified successfully.' });
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  const { email, otp, password } = req.body || {};
  if (!email || !otp || !password) return res.status(400).json({ error: 'Email, OTP, and new password are required.' });

  const otpRecord = db.prepare('SELECT * FROM otps WHERE email = ? AND otp = ? ORDER BY expires_at DESC').get(email.toLowerCase(), otp);

  if (!otpRecord) {
    return res.status(401).json({ error: 'Invalid OTP.' });
  }

  const now = new Date();
  const expiresAt = new Date(otpRecord.expires_at);

  if (now > expiresAt) {
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.status(401).json({ error: 'OTP has expired.' });
  }

  const hashed = await bcrypt.hash(password, 12);
  try {
    const stmt = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?');
    stmt.run(hashed, email.toLowerCase());
    db.prepare('DELETE FROM otps WHERE id = ?').run(otpRecord.id);
    return res.json({ ok: true, message: 'Password reset successfully.' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

// Authenticated user status endpoint using bearer token
router.get('/status', (req, res) => {
  try {
    const tok = getBearerToken(req);
    // Return 401 for missing/invalid authentication rather than 400
    if (!tok) return res.status(401).json({ error: 'Missing authorization bearer token.' });
    const v = verifyTokenRaw(tok);
    if (!v.ok) return res.status(401).json({ error: 'Invalid token.' });
    const claims = v.decoded;
    const user = db.prepare('SELECT id, email, is_admin, is_banned, suspended_until, username FROM users WHERE id = ?').get(Number(claims.user_id));
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({
      ok: true,
      email: user.email,
      username: user.username || null,
      is_admin: !!user.is_admin,
      is_banned: !!user.is_banned,
      suspended_until: user.suspended_until || null
    });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

export default router;
