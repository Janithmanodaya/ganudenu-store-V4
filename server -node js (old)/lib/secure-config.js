import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const secureConfigPath = path.resolve(process.cwd(), 'data', 'secure-config.enc');
let cached = null;
let cachedMtime = null;

function deriveKey(pass) {
  const salt = crypto.createHash('sha256').update('ganudenu-config-salt').digest();
  return crypto.scryptSync(String(pass), salt, 32);
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

/**
 * Load and decrypt secure-config if present and passphrase provided via SECURE_CONFIG_PASSPHRASE.
 * Cache in-memory and refresh when file mtime changes.
 */
export function getSecureConfig() {
  try {
    const pass = process.env.SECURE_CONFIG_PASSPHRASE;
    if (!pass) return null;
    if (!fs.existsSync(secureConfigPath)) return null;
    const stat = fs.statSync(secureConfigPath);
    if (cached && cachedMtime && stat.mtimeMs === cachedMtime) {
      return cached;
    }
    const b64 = fs.readFileSync(secureConfigPath, 'utf8');
    const json = decryptConfig(pass, b64);
    const obj = JSON.parse(json);
    cached = obj;
    cachedMtime = stat.mtimeMs;
    return obj;
  } catch (_) {
    return null;
  }
}

/**
 * Helper to get secrets from secure-config with env fallback.
 * Keys mapping:
 * - 'gemini_api_key' -> env GEMINI_API_KEY
 * - SMTP: 'smtp_host','smtp_port','smtp_secure','smtp_user','smtp_pass','smtp_from'
 * - Brevo: 'brevo_api_key','brevo_login'
 */
export function getSecret(key) {
  const cfg = getSecureConfig();
  if (cfg && Object.prototype.hasOwnProperty.call(cfg, key)) {
    return cfg[key];
  }
  const map = {
    gemini_api_key: process.env.GEMINI_API_KEY,
    smtp_host: process.env.SMTP_HOST,
    smtp_port: process.env.SMTP_PORT,
    smtp_secure: process.env.SMTP_SECURE,
    smtp_user: process.env.SMTP_USER,
    smtp_pass: process.env.SMTP_PASS,
    smtp_from: process.env.SMTP_FROM || process.env.BREVO_LOGIN,
    brevo_api_key: process.env.BREVO_API_KEY,
    brevo_login: process.env.BREVO_LOGIN
  };
  return map[key];
}