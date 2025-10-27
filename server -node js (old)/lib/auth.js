import jwt from 'jsonwebtoken';
import { db } from './db.js';
import fs from 'fs';
import path from 'path';

/**
 * Auth utilities: JWT issuing and verification.
 * - Tokens carry { user_id, email, is_admin } claims
 * - HS256 signed with JWT_SECRET
 * - Default expiry: 7 days
 */

function loadJwtSecret() {
  const env = process.env.JWT_SECRET;
  if (env) return env;
  try {
    const p = path.resolve(process.cwd(), 'data', 'jwt-secret.txt');
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    }
    const rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const val = 'dev-secret-' + rnd;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, val, { encoding: 'utf8' });
    } catch (_) {}
    return val;
  } catch (_) {
    const rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return 'dev-secret-' + rnd;
  }
}

const JWT_SECRET = loadJwtSecret();

const DEFAULT_EXP = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(user) {
  const payload = {
    user_id: user.id,
    email: user.email.toLowerCase(),
    is_admin: !!user.is_admin,
    // Optional MFA claim for admin flows
    mfa: user.mfa ? true : false
  };
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: DEFAULT_EXP });
}

export function verifyTokenRaw(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    return { ok: true, decoded };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/**
 * Extract bearer token from Authorization header.
 */
export function getBearerToken(req) {
  // 1) Authorization header
  const hdr = String(req.headers['authorization'] || '');
  if (hdr) {
    const parts = hdr.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) return parts[1];
  }

  // 2) Cookie header (auth_token)
  try {
    const rawCookie = String(req.headers['cookie'] || '');
    if (rawCookie) {
      // Minimal cookie parsing without dependencies
      const items = rawCookie.split(';').map(s => s.trim()).filter(Boolean);
      for (const it of items) {
        const idx = it.indexOf('=');
        if (idx > 0) {
          const name = it.slice(0, idx).trim();
          const val = it.slice(idx + 1).trim();
          if (name === 'auth_token' && val) {
            return decodeURIComponent(val);
          }
        }
      }
    }
  } catch (_) {}

  return null;
}

/**
 * requireUser middleware: verifies JWT and loads minimal user info.
 */
export function requireUser(req, res, next) {
  const tok = getBearerToken(req);
  if (!tok) return res.status(401).json({ error: 'Missing Authorization bearer token' });
  const v = verifyTokenRaw(tok);
  if (!v.ok) return res.status(401).json({ error: 'Invalid token' });
  const claims = v.decoded;
  // Basic ban/suspension enforcement
  try {
    const row = db.prepare('SELECT id, email, is_banned, suspended_until, is_admin FROM users WHERE id = ?').get(Number(claims.user_id));
    if (!row || String(row.email).toLowerCase() !== String(claims.email).toLowerCase()) {
      return res.status(401).json({ error: 'Invalid user' });
    }
    // Non-admin users: enforce bans/suspensions
    if (!row.is_admin) {
      if (row.is_banned) return res.status(403).json({ error: 'Account banned' });
      if (row.suspended_until && row.suspended_until > new Date().toISOString()) {
        return res.status(403).json({ error: 'Account suspended' });
      }
    }
    req.user = { id: row.id, email: row.email.toLowerCase(), is_admin: !!row.is_admin };
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

/**
 * requireAdmin middleware: verifies JWT and admin flag.
 */
export function requireAdmin(req, res, next) {
  const tok = getBearerToken(req);
  if (!tok) return res.status(401).json({ error: 'Missing Authorization bearer token' });
  const v = verifyTokenRaw(tok);
  if (!v.ok) return res.status(401).json({ error: 'Invalid token' });
  const claims = v.decoded;
  try {
    const row = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(Number(claims.user_id));
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Forbidden' });
    if (String(row.email).toLowerCase() !== String(claims.email).toLowerCase()) {
      return res.status(401).json({ error: 'Invalid user' });
    }
    req.admin = { id: row.id, email: row.email.toLowerCase() };
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Admin auth failed' });
  }
}

/**
 * requireAdmin2FA middleware: requires admin token with MFA=true claim.
 * This is issued only by the /verify-admin-login-otp flow.
 */
export function requireAdmin2FA(req, res, next) {
  const tok = getBearerToken(req);
  if (!tok) return res.status(401).json({ error: 'Missing Authorization bearer token' });
  const v = verifyTokenRaw(tok);
  if (!v.ok) return res.status(401).json({ error: 'Invalid token' });
  const claims = v.decoded;
  if (!claims.mfa) return res.status(401).json({ error: 'Admin 2FA required' });
  try {
    const row = db.prepare('SELECT id, email, is_admin FROM users WHERE id = ?').get(Number(claims.user_id));
    if (!row || !row.is_admin) return res.status(403).json({ error: 'Forbidden' });
    if (String(row.email).toLowerCase() !== String(claims.email).toLowerCase()) {
      return res.status(401).json({ error: 'Invalid user' });
    }
    req.admin = { id: row.id, email: row.email.toLowerCase() };
    next();
  } catch (e) {
    return res.status(500).json({ error: 'Admin auth failed' });
  }
}