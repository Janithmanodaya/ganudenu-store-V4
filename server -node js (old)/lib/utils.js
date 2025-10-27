import fetch from 'node-fetch';
import nodemailer from 'nodemailer';
import { getSecret } from './secure-config.js';

export function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/**
 * Generate a short, unique public user ID (UID) suitable for display.
 * Format: GN-<base36 timestamp>-<base36 random>
 */
export function generateUserUID() {
  const ts = Math.floor(Date.now() / 1000).toString(36);
  const rnd = Math.floor(Math.random() * 1679616).toString(36).padStart(3, '0'); // 36^3
  return `GN-${ts}-${rnd}`.toUpperCase();
}

/**
 * sendEmail
 * Priority:
 * 1) If EMAIL_DEV_MODE=true OR missing env → log locally and return ok:true
 * 2) If SMTP_HOST is set → use nodemailer SMTP transport (common providers: Gmail, Mailgun, etc.)
 * 3) Else fallback to Brevo HTTP API (requires BREVO_API_KEY + BREVO_LOGIN)
 */
export async function sendEmail(to, subject, htmlContent) {
  const DEV_MODE = String(process.env.EMAIL_DEV_MODE || '').toLowerCase() === 'true';

  if (DEV_MODE) {
    console.warn('[email] Dev mode enabled. Logging email locally.');
    console.log(`[email:dev]\nTo: ${to}\nSubject: ${subject}\nContent:\n${htmlContent}`);
    return { ok: true, dev: true };
  }

  // Try generic SMTP first if available (secure-config preferred)
  const SMTP_HOST = getSecret('smtp_host');
  const SMTP_PORT = Number(getSecret('smtp_port') || 587);
  const SMTP_SECURE = String(getSecret('smtp_secure') || '').toLowerCase() === 'true';
  const SMTP_USER = getSecret('smtp_user');
  const SMTP_PASS = getSecret('smtp_pass');
  const SMTP_FROM = getSecret('smtp_from') || 'no-reply@example.com';

  if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        html: htmlContent
      });
      console.log('[email] Sent via SMTP:', info.messageId);
      return { ok: true, data: { messageId: info.messageId } };
    } catch (err) {
      console.error('[email] SMTP send failed:', err);
      // continue to Brevo fallback
    }
  }

  // Brevo fallback via HTTP (secure-config preferred)
  const BREVO_API_KEY = getSecret('brevo_api_key');
  const BREVO_LOGIN = getSecret('brevo_login');
  if (!BREVO_API_KEY || !BREVO_LOGIN) {
    console.error('[email] No SMTP config and Brevo credentials missing.');
    return { ok: false, error: 'Email provider not configured.' };
  }

  try {
    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: 'Ganudenu', email: BREVO_LOGIN },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[email] Brevo HTTP error:', resp.status, data);
      return { ok: false, error: data?.message || `HTTP ${resp.status}` };
    }
    console.log('[email] Sent via Brevo HTTP:', JSON.stringify(data));
    return { ok: true, data };
  } catch (error) {
    console.error('[email] Brevo send failed:', error);
    return { ok: false, error: String(error) };
  }
}
