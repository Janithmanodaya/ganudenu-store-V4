import request from 'supertest';
import app from '../app.js';
import { db } from '../lib/db.js';
import bcrypt from 'bcrypt';

describe('Authenticated Health Check - Auth, Admin 2FA, Protected endpoints, Jobs/Notifications/Users/Wanted', () => {
  const userEmail = 'health_user@example.com';
  const userPass = 'HealthUser123!';
  const adminEmail = 'health_admin@example.com';
  const adminPass = 'HealthAdmin123!';

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

    // Ensure OTP values are returned to test process
    process.env.EMAIL_DEV_MODE = 'true';
  });

  test('User login and protected /api/listings/my', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: userEmail, password: userPass });
    expect(login.status).toBe(200);
    expect(login.body?.token).toBeTruthy();
    userToken = login.body.token;

    // Protected requires bearer
    const noAuth = await request(app).get('/api/listings/my');
    expect(noAuth.status).toBe(401);

    const withAuth = await request(app)
      .get('/api/listings/my')
      .set('Authorization', `Bearer ${userToken}`);
    expect(withAuth.status).toBe(200);
    expect(withAuth.body?.results).toBeDefined();
  });

  test('Admin login requires OTP; 2FA token grants admin access', async () => {
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: adminEmail, password: adminPass });
    expect(adminLogin.status).toBe(200);
    expect(adminLogin.body?.otp_required).toBe(true);
    adminOtp = adminLogin.body?.otp;
    expect(adminOtp).toBeTruthy();

    const verify = await request(app)
      .post('/api/auth/verify-admin-login-otp')
      .send({ email: adminEmail, password: adminPass, otp: adminOtp });
    expect(verify.status).toBe(200);
    expect(verify.body?.token).toBeTruthy();
    adminToken = verify.body.token;

    const adminConfig = await request(app)
      .get('/api/admin/config')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminConfig.status).toBe(200);
    expect(adminConfig.body).toHaveProperty('payment_rules');
  });

  test('Notifications saved-search CRUD and listing list', async () => {
    // Create a saved search
    const create = await request(app)
      .post('/api/notifications/saved-searches')
      .set('X-User-Email', userEmail)
      .send({ name: 'Vehicle Colombo', category: 'Vehicle', location: 'Colombo', price_min: 0, price_max: 5000000 });
    expect(create.status).toBe(200);

    // List saved searches
    const list = await request(app)
      .get('/api/notifications/saved-searches')
      .set('X-User-Email', userEmail);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body?.results)).toBe(true);
    const first = list.body?.results?.[0];

    // Unread count and notifications list (should succeed even when empty)
    const unread = await request(app)
      .get('/api/notifications/unread-count')
      .set('X-User-Email', userEmail);
    expect(unread.status).toBe(200);
    expect(typeof unread.body?.unread_count).toBe('number');

    const notifs = await request(app)
      .get('/api/notifications')
      .set('X-User-Email', userEmail);
    expect(notifs.status).toBe(200);
    expect(Array.isArray(notifs.body?.results)).toBe(true);

    // Delete saved search if exists
    if (first?.id) {
      const del = await request(app)
        .delete(`/api/notifications/saved-searches/${first.id}`)
        .set('X-User-Email', userEmail);
      expect([200, 404]).toContain(del.status);
    }
  });

  test('Users profile get and upsert', async () => {
    const view = await request(app)
      .get('/api/users/profile')
      .query({ email: userEmail });
    expect([200, 404]).toContain(view.status);
    if (view.status === 200) {
      expect(view.body?.user?.email).toBe(userEmail);
    }

    // Upsert profile
    const up = await request(app)
      .post('/api/users/profile')
      .set('X-User-Email', userEmail)
      .send({ bio: 'Health check user profile', verified_email: true, verified_phone: false });
    expect(up.status).toBe(200);
  });

  test('Wanted: create, list my, close', async () => {
    const create = await request(app)
      .post('/api/wanted')
      .set('X-User-Email', userEmail)
      .send({
        title: 'Looking for a used Toyota car',
        category: 'Vehicle',
        locations: ['Colombo'],
        price_min: 1000000,
        price_max: 8000000,
        price_not_matter: false
      });
    expect(create.status).toBe(200);
    const wid = create.body?.id;
    expect(wid).toBeTruthy();

    const myList = await request(app)
      .get('/api/wanted/my')
      .set('X-User-Email', userEmail);
    expect(myList.status).toBe(200);
    expect(Array.isArray(myList.body?.results)).toBe(true);

    const close = await request(app)
      .post(`/api/wanted/${wid}/close`)
      .set('X-User-Email', userEmail);
    expect(close.status).toBe(200);
  });

  test('Jobs: endpoint exists and validates payload', async () => {
    // Without file should error 400
    const r = await request(app)
      .post('/api/jobs/employee/draft')
      .send({ name: 'Test', target_title: 'Developer', summary: 'Summary' });
    expect(r.status).toBe(400);
  });

  test('Protected admin endpoints reject without token', async () => {
    const res = await request(app).get('/api/admin/config');
    expect(res.status).toBe(401);
  });
});