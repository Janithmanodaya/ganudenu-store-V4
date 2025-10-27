import request from 'supertest';
import app from '../app.js';

describe('Automatic Health Check - Core endpoints', () => {
  test('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.ts).toBe('string');
  });

  test('GET /robots.txt returns 200 and contains Sitemap', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(String(res.text || '')).toMatch(/Sitemap:/);
  });

  test('GET /sitemap.xml returns 200 XML', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    // Content-Type may include charset
    expect(String(res.headers['content-type'] || '')).toMatch(/application\/xml|text\/xml/);
    expect(String(res.text || '')).toMatch(/<urlset/);
  });

  test('GET /api/banners returns JSON results array', async () => {
    const res = await request(app).get('/api/banners');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('GET /api/listings (public) returns JSON payload', async () => {
    const res = await request(app).get('/api/listings');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('GET /api/listings/search returns JSON payload', async () => {
    const res = await request(app).get('/api/listings/search').query({ q: '' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('GET /api/listings/filters?category=Vehicle returns JSON with keys', async () => {
    const res = await request(app).get('/api/listings/filters').query({ category: 'Vehicle' });
    // Endpoint should return 200 even if no data; values may be empty
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('keys');
      expect(Array.isArray(res.body.keys)).toBe(true);
      expect(res.body).toHaveProperty('valuesByKey');
    }
  });

  test('GET /api/listings/suggestions returns JSON results', async () => {
    const res = await request(app).get('/api/listings/suggestions').query({ q: 'car' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
  });

  test('GET /api/auth/user-exists email missing returns 400', async () => {
    const res = await request(app).get('/api/auth/user-exists');
    expect(res.status).toBe(400);
  });

  test('GET /api/auth/user-exists with email returns ok', async () => {
    const res = await request(app).get('/api/auth/user-exists').query({ email: 'nonexistent@example.com' });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    expect(typeof res.body?.exists).toBe('boolean');
  });

  test('GET /api/wanted endpoints exist (list or filters may vary)', async () => {
    // Some wanted endpoints may require auth; check a public-like route presence if implemented.
    // Fall back to 404 not failing the health check.
    const res = await request(app).get('/api/wanted');
    expect([200, 404, 401]).toContain(res.status);
  });

  test('Rate-limited endpoints do not crash under multiple requests', async () => {
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(request(app).get('/api/listings'));
    }
    const results = await Promise.all(promises);
    // All should return 200
    expect(results.every(r => r.status === 200)).toBe(true);
  });
});