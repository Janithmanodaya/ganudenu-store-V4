import request from 'supertest';
import app from '../app.js';
import { db } from '../lib/db.js';
import bcrypt from 'bcrypt';

describe('Protected routes authentication', () => {
  let userEmail = 'testuser@example.com';
  let userPass = 'Password123!';
  let adminEmail = 'admin@example.com';
  let adminPass = 'AdminStrong123!';
  let userToken = null;
  let adminToken = null;
  let adminOtp = null;

  beforeAll(async () => {
    // Seed user
    try {
      const u = db.prepare('SELECT id FROM users WHERE email = ?').get(userEmail);
      const hash = await bcrypt.hash(userPass, 12);
      if (u) {
        db.prepare('UPDATE users SET password_hash = ?, is_admin = 0 WHERE id = ?').run(hash, u.id);
      } else {
        db.prepare('INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 0, ?)').run(
          userEmail, hash, new Date().toISOString()
        );
      }
    } catch (_) {}

    // Seed admin
    try {
      const a = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
      const hash = await bcrypt.hash(adminPass, 12);
      if (a) {
        db.prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, a.id);
      } else {
        db.prepare('INSERT INTO users (email, password_hash, is_admin, created_at) VALUES (?, ?, 1, ?)').run(
          adminEmail, hash, new Date().toISOString()
        );
      }
    } catch (_) {}
    process.env.EMAIL_DEV_MODE = 'true'; // ensure OTPs are returned in responses
  });

  test('User login issues JWT and protected /api/listings/my requires it', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: userEmail, password: userPass });
    expect(login.status).toBe(200);
    expect(login.body?.token).toBeTruthy();
    userToken = login.body.token;

    const noAuth = await request(app).get('/api/listings/my');
    expect(noAuth.status).toBe(401);

    const withAuth = await request(app)
      .get('/api/listings/my')
      .set('Authorization', `Bearer ${userToken}`);
    expect(withAuth.status).toBe(200);
    expect(withAuth.body?.results).toBeDefined();
  });

  test('Admin login requires OTP and admin protected endpoints deny without 2FA', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: adminEmail, password: adminPass });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body?.otp_required).toBe(true);
    adminOtp = adminLogin.body?.otp;
    expect(adminOtp).toBeTruthy();

    // Attempt to access an admin protected endpoint without token
    const noToken = await request(app).get('/api/admin/config');
    expect(noToken.status).toBe(401);

    // Verify OTP to obtain MFA token
    const verify = await request(app)
      .post('/api/auth/verify-admin-login-otp')
      .send({ email: adminEmail, password: adminPass, otp: adminOtp });
    expect(verify.status).toBe(200);
    expect(verify.body?.token).toBeTruthy();
    adminToken = verify.body.token;

    // Access admin endpoint with token
    const config = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(config.status).toBe(200);

    // /restore specifically requires 2FA token and file upload
    const restoreNoFile = await request(app)
      .post('/api/admin/restore')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(restoreNoFile.status).toBe(400);
    expect(String(restoreNoFile.body?.error || '')).toMatch(/Backup file/);
  });
});