/**
 * PHP backend health checker for Smart MiniMap + AutoRoutes deployment.
 *
 * Usage:
 *   node scripts/health-check-php.js https://your-domain.com
 * or:
 *   TARGET=https://your-domain.com npm run health:php
 *
 * The script will probe both direct routes (/api/health) and index.php override
 * (/api/index.php?r=/api/health) to support hosts without proper rewrite rules.
 */

import fetch from 'node-fetch';

const BASE = (() => {
  const arg = (process.argv[2] || '').trim();
  const env = (process.env.TARGET || process.env.BASE_URL || '').trim();
  const v = arg || env;
  if (!v) {
    console.error('[health] ERROR: Target base URL not provided.\nProvide e.g.:\n  node scripts/health-check-php.js https://ganudenu.store\nor\n  TARGET=https://ganudenu.store npm run health:php');
    process.exit(2);
  }
  return v.replace(/\/+$/, '');
})();

function urlJoin(base, path) {
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
}

async function get(path) {
  // Try direct route first (preferred when .htaccess is working)
  const direct = urlJoin(BASE, path);
  let res, text;
  try {
    res = await fetch(direct, { redirect: 'manual' });
    text = await res.text();
    return { url: direct, ok: res.ok, status: res.status, text, headers: res.headers };
  } catch (e) {
    // Fallthrough to index.php override
  }

  // Fallback: /api/index.php?r=/api/...
  if (path.startsWith('/api/')) {
    const encoded = encodeURIComponent(path);
    const idxUrl = urlJoin(BASE, `/api/index.php?r=${encoded}`);
    try {
      res = await fetch(idxUrl, { redirect: 'manual' });
      text = await res.text();
      return { url: idxUrl, ok: res.ok, status: res.status, text, headers: res.headers };
    } catch (e) {
      return { url: idxUrl, ok: false, status: 0, text: String(e) };
    }
  }

  // No fallback for non-/api paths
  return { url: direct, ok: false, status: 0, text: 'Network error' };
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

async function check(name, path, validate) {
  const res = await get(path);
  const ok = await validate(res);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} -> ${res.url} (status ${res.status})`);
  if (!ok) {
    const snippet = (res.text || '').slice(0, 300).replace(/\s+/g, ' ');
    console.log(`      Response: ${snippet}`);
  }
  return ok;
}

async function main() {
  console.log(`[health] Target: ${BASE}`);

  const results = [];

  // Core checks
  results.push(await check('Health endpoint', '/api/health', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && j.ok === true && typeof j.ts === 'string';
  }));

  results.push(await check('Robots.txt exists', '/robots.txt', (r) => {
    return r.status === 200 && /sitemap/i.test(r.text || '');
  }));

  results.push(await check('Sitemap.xml exists', '/sitemap.xml', (r) => {
    const ct = String(r.headers.get('content-type') || '');
    return r.status === 200 && (ct.includes('xml') || /<urlset/.test(r.text || ''));
  }));

  results.push(await check('Banners endpoint', '/api/banners', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && Array.isArray(j.results);
  }));

  results.push(await check('Maintenance status', '/api/maintenance-status', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && typeof j.enabled !== 'undefined';
  }));

  results.push(await check('Listings list', '/api/listings', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && Array.isArray(j.results);
  }));

  results.push(await check('Listings search', '/api/listings/search?q=', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && Array.isArray(j.results);
  }));

  results.push(await check('User exists (no email -> 400)', '/api/auth/user-exists', (r) => {
    return r.status === 400;
  }));

  results.push(await check('User exists (sample)', '/api/auth/user-exists?email=nonexistent@example.com', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && typeof j.exists === 'boolean';
  }));

  // Top-level Google redirect helpers
  results.push(await check('Auth redirect helper (/auth/google/start)', '/auth/google/start', (r) => {
    // Should redirect to /api/auth/google/start or be 200 if PHP endpoint handles directly
    return [200, 302, 307].includes(r.status);
  }));

  // Minimap JSON should be created after first API hit
  // Trigger again to ensure it exists now; then fetch
  await get('/api/health');
  results.push(await check('Minimap JSON generated', '/api/var/minimap.json', (r) => {
    const j = parseJson(r.text);
    return r.status === 200 && j && Array.isArray(j.files) && Array.isArray(j.apis);
  }));

  const pass = results.every(Boolean);
  console.log(`[health] Summary: ${pass ? 'PASS' : 'FAIL'} (${results.filter(Boolean).length}/${results.length} passed)`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('[health] Uncaught error:', e);
  process.exit(1);
});