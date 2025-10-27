/**
 * Client-side recommendation engine using a compact cookie profile.
 * Enhancements: time-decay on interests, trending boost, smarter similarity,
 * sessionStorage caching for search pools, and preference diversification.
 */

const COOKIE_NAME = 'gd_reco_profile';
const COOKIE_MAX_DAYS = 90;

// Cookie helpers
function readCookie(name) {
  try {
    const parts = document.cookie.split(';').map(s => s.trim());
    for (const p of parts) {
      if (!p) continue;
      const [k, ...rest] = p.split('=');
      if (decodeURIComponent(k) === name) {
        const v = rest.join('=');
        return decodeURIComponent(v || '');
      }
    }
  } catch (_) {}
  return '';
}
function writeCookie(name, value, days) {
  try {
    const d = new Date();
    d.setTime(d.getTime() + Math.max(1, (days || COOKIE_MAX_DAYS)) * 24 * 60 * 60 * 1000);
    const expires = 'expires=' + d.toUTCString();
    document.cookie = encodeURIComponent(name) + '=' + encodeURIComponent(value) + ';' + expires + ';path=/;SameSite=Lax';
  } catch (_) {}
}
function getProfile() {
  try {
    const raw = readCookie(COOKIE_NAME);
    if (!raw) return defaultProfile();
    const obj = JSON.parse(raw);
    return sanitizeProfile(obj);
  } catch (_) {
    return defaultProfile();
  }
}
function setProfile(p) {
  try {
    const compact = compactProfile(p);
    writeCookie(COOKIE_NAME, JSON.stringify(compact), COOKIE_MAX_DAYS);
  } catch (_) {}
}
function defaultProfile() {
  return {
    categories: {},
    sub_categories: {},
    models: {},
    locations: {},
    keywords: {},
    price_buckets: {
      '0-100k': 0,
      '100k-500k': 0,
      '500k-1m': 0,
      '1m-3m': 0,
      '3m+': 0
    },
    recent_listing_ids: [],
    last_searches: [],
    updated_at: Date.now()
  };
}
function sanitizeProfile(p) {
  const d = defaultProfile();
  const out = { ...d, ...(p || {}) };
  out.categories = out.categories || {};
  out.sub_categories = out.sub_categories || {};
  out.models = out.models || {};
  out.locations = out.locations || {};
  out.keywords = out.keywords || {};
  out.price_buckets = out.price_buckets || d.price_buckets;
  out.recent_listing_ids = Array.isArray(out.recent_listing_ids) ? out.recent_listing_ids.slice(-20) : [];
  out.last_searches = Array.isArray(out.last_searches) ? out.last_searches.slice(-10) : [];
  out.updated_at = Number(out.updated_at || Date.now());
  return out;
}
function compactProfile(p) {
  const trimObj = (obj, max = 24) => {
    const entries = Object.entries(obj || {});
    entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const trimmed = entries.slice(0, max);
    return Object.fromEntries(trimmed);
  };
  return {
    categories: trimObj(p.categories, 12),
    sub_categories: trimObj(p.sub_categories, 24),
    models: trimObj(p.models, 24),
    locations: trimObj(p.locations, 24),
    keywords: trimObj(p.keywords, 48),
    price_buckets: p.price_buckets || defaultProfile().price_buckets,
    recent_listing_ids: Array.isArray(p.recent_listing_ids) ? p.recent_listing_ids.slice(-20) : [],
    last_searches: Array.isArray(p.last_searches) ? p.last_searches.slice(-10) : [],
    updated_at: Date.now()
  };
}

// Utils
function bump(map, key, inc = 1) {
  if (!key) return;
  const k = String(key).trim();
  if (!k) return;
  map[k] = (map[k] || 0) + Number(inc);
}
function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}
const STOP_WORDS = new Set([
  'the','and','for','with','from','this','that','your','you','our',
  'in','on','to','of','a','an','by','at','or','as','is','are','was','were',
  'new','like','very','good','best','great'
]);

function priceBucket(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return null;
  if (v <= 100_000) return '0-100k';
  if (v <= 500_000) return '100k-500k';
  if (v <= 1_000_000) return '500k-1m';
  if (v <= 3_000_000) return '1m-3m';
  return '3m+';
}

// Time-decay profile: half-life ≈ 30 days
function applyDecay(p) {
  const days = Math.max(0, (Date.now() - Number(p.updated_at || Date.now())) / 86_400_000);
  const factor = Math.pow(0.5, days / 30);
  const scale = (obj) => {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const s = Number(v || 0) * factor;
      if (s > 0.2) out[k] = Number(s.toFixed(4));
    }
    return out;
  };
  const pb = { ...p.price_buckets };
  for (const k of Object.keys(pb || {})) {
    pb[k] = Number(pb[k] || 0) * factor;
  }
  return {
    categories: scale(p.categories),
    sub_categories: scale(p.sub_categories),
    models: scale(p.models),
    locations: scale(p.locations),
    keywords: scale(p.keywords),
    price_buckets: pb,
    recent_listing_ids: Array.isArray(p.recent_listing_ids) ? p.recent_listing_ids.slice() : [],
    last_searches: Array.isArray(p.last_searches) ? p.last_searches.slice() : [],
    updated_at: p.updated_at
  };
}

function brandFromModel(s) {
  const t = String(s || '').toLowerCase();
  const brands = ['honda','yamaha','suzuki','bajaj','tvs','hero','kawasaki','mahindra','royal enfield','vespa','toyota','nissan','mazda','mitsubishi','hyundai','kia','renault','peugeot','ford','isuzu','subaru'];
  for (const b of brands) {
    const re = new RegExp('\\b' + b.replace(/\s+/g, '\\s+') + '\\b', 'i');
    if (re.test(t)) return b.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

function parseListing(listing) {
  const sj = (() => { try { return JSON.parse(listing.structured_json || '{}'); } catch (_) { return {}; } })();
  const main_category = String(listing.main_category || '').trim();
  const sub_category = String(sj.sub_category || '').trim();
  const model_name = String(sj.model_name || '').trim();
  const manufacturer = String(sj.manufacturer || '').trim() || brandFromModel(model_name);
  const location = String(listing.location || '').trim();
  const price = listing.price != null ? Number(listing.price) : null;
  const year = sj.manufacture_year != null ? Number(sj.manufacture_year) : null;
  const title = String(listing.title || '');
  const desc = String(listing.seo_description || listing.description || '');
  const tokens = Array.from(new Set([
    ...tokenize(title),
    ...tokenize(desc),
    ...tokenize(model_name),
    ...tokenize(sub_category),
    ...tokenize(manufacturer)
  ]));
  const urgent = !!(listing.is_urgent || listing.urgent);
  const created_at = listing.created_at ? new Date(listing.created_at).getTime() : null;
  const views = listing.views != null ? Number(listing.views) : 0;
  return { main_category, sub_category, model_name, manufacturer, location, price, year, tokens, urgent, created_at, views };
}

// Tracking
export function trackSearch(term) {
  try {
    const p = getProfile();
    const tks = tokenize(term);
    for (const t of tks) bump(p.keywords, t, 1.6);
    p.last_searches = [...p.last_searches, String(term)].slice(-10);
    p.updated_at = Date.now();
    setProfile(p);
  } catch (_) {}
}

export function trackView(listing) {
  try {
    const p = getProfile();
    const f = parseListing(listing);
    if (f.main_category) bump(p.categories, f.main_category, 2.2);
    if (f.sub_category) bump(p.sub_categories, f.sub_category, 1.6);
    if (f.model_name) bump(p.models, f.model_name, 1.6);
    if (f.location) bump(p.locations, f.location, 1.2);
    for (const t of f.tokens) bump(p.keywords, t, 1);
    const pb = priceBucket(f.price);
    if (pb) bump(p.price_buckets, pb, 1);
    const id = Number(listing.id);
    if (Number.isFinite(id)) {
      const next = Array.isArray(p.recent_listing_ids) ? p.recent_listing_ids.filter(x => Number(x) !== id) : [];
      p.recent_listing_ids = [...next, id].slice(-20);
    }
    p.updated_at = Date.now();
    setProfile(p);
  } catch (_) {}
}

// Core scoring
function scoreListing(listing, profile, context) {
  const f = parseListing(listing);
  let score = 0;

  // Category/sub/model/location match
  if (f.main_category) score += (profile.categories[f.main_category] || 0) * 3.2;
  if (f.sub_category) score += (profile.sub_categories[f.sub_category] || 0) * 2.4;
  if (f.model_name) score += (profile.models[f.model_name] || 0) * 2.2;
  if (f.location) score += (profile.locations[f.location] || 0) * 1.6;

  // Manufacturer keyword preference
  if (f.manufacturer) score += (profile.keywords[String(f.manufacturer).toLowerCase()] || 0) * 1.4;

  // Keyword affinity
  for (const t of f.tokens) score += (profile.keywords[t] || 0) * 1.0;

  // Query overlap
  const lastQ = String(context?.query || '').trim().toLowerCase();
  if (lastQ) {
    const qTokens = tokenize(lastQ);
    const overlap = qTokens.filter(t => f.tokens.includes(t)).length;
    score += overlap * 2.6;
  }

  // Price preference: bucket proximity
  const pb = priceBucket(f.price);
  if (pb) score += (profile.price_buckets[pb] || 0) * 1.3;

  // Recency boost (half-life ~14 days)
  if (f.created_at) {
    const days = Math.max(0, (Date.now() - f.created_at) / 86_400_000);
    const recency = Math.max(0, 1.0 - Math.min(1.0, days / 14));
    score += recency * 5.0;
  }

  // Urgent boost
  if (f.urgent) score += 3.2;

  // Trending views boost (log-scale)
  if (Number.isFinite(f.views) && f.views > 0) {
    const v = Math.log10(1 + Math.max(0, f.views));
    score += v * 2.0;
  }

  // Price closeness if a target price provided
  if (Number.isFinite(context?.targetPrice) && Number.isFinite(f.price)) {
    const tp = Number(context.targetPrice);
    const diff = Math.abs(f.price - tp);
    const rel = tp > 0 ? Math.max(0, 1 - (diff / tp)) : 0;
    score += rel * 3.0;
  }

  // Year closeness if target year provided
  if (Number.isFinite(context?.targetYear) && Number.isFinite(f.year)) {
    const dy = Math.abs(Number(context.targetYear) - Number(f.year));
    const yscore = Math.max(0, 1 - Math.min(1, dy / 5)); // within 5 years
    score += yscore * 2.0;
  }

  // Focus category slight boost
  if (context?.focusCategory && f.main_category && f.main_category === context.focusCategory) {
    score += 1.4;
  }

  // Tie-breaker: lower price slight boost
  if (Number.isFinite(f.price)) {
    const pr = Math.log10(Math.max(1, f.price));
    score += Math.max(0, 5.0 - pr) * 0.35;
  }

  // Penalize items already viewed recently
  if (Array.isArray(profile.recent_listing_ids) && profile.recent_listing_ids.includes(Number(listing.id))) {
    score *= 0.6;
  }

  return score;
}

function topKeys(obj, n = 1) {
  const entries = Object.entries(obj || {});
  entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
  return entries.slice(0, n).map(([k]) => k);
}

// Lightweight session cache for pools (~25s TTL)
function readPoolCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj.ts && (Date.now() - obj.ts) < 25_000) return obj.results || null;
  } catch (_) {}
  return null;
}
function writePoolCache(key, results) {
  try {
    const payload = { ts: Date.now(), results: Array.isArray(results) ? results : [] };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (_) {}
}

async function fetchPool(opts) {
  const sort = String(opts?.sort || 'random');
  const params = new URLSearchParams();
  params.set('sort', sort);
  params.set('page', '1');
  params.set('limit', String(Math.max(20, Math.min(100, opts?.limit || 60))));
  if (opts?.category) params.set('category', opts.category);
  if (opts?.location) params.set('location', opts.location);
  if (opts?.filters && Object.keys(opts.filters).length) params.set('filters', JSON.stringify(opts.filters));
  const url = `/api/listings/search?${params.toString()}`;

  const cacheKey = 'pool:' + url + (opts?.excludeCategories ? '|ex:' + String(opts.excludeCategories) : '');
  const cached = readPoolCache(cacheKey);
  if (cached) {
    // Apply exclude filter + dedupe
    let arr = Array.isArray(cached) ? cached.slice() : [];
    if (opts?.excludeCategories) {
      const exSet = new Set(Array.isArray(opts.excludeCategories) ? opts.excludeCategories : [opts.excludeCategories]);
      arr = arr.filter(x => !exSet.has(String(x.main_category || '')));
    }
    const seen = new Set();
    const uniq = [];
    for (const it of arr) {
      const id = Number(it.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id); uniq.push(it);
    }
    return uniq;
  }

  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return [];
  let results = Array.isArray(data.results) ? data.results : [];
  if (opts?.excludeCategories) {
    const exSet = new Set(Array.isArray(opts.excludeCategories) ? opts.excludeCategories : [opts.excludeCategories]);
    results = results.filter(x => !exSet.has(String(x.main_category || '')));
  }
  // Dedupe by id
  const seen = new Set();
  const uniq = [];
  for (const it of results) {
    const id = Number(it.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id); uniq.push(it);
  }
  writePoolCache(cacheKey, uniq);
  return uniq;
}

export async function getSuggestedListings(context = {}) {
  const raw = getProfile();
  const profile = applyDecay(raw);

  const category = topKeys(profile.categories, 1)[0] || '';
  const location = topKeys(profile.locations, 1)[0] || '';
  const sub = topKeys(profile.sub_categories, 1)[0] || '';
  const model = topKeys(profile.models, 1)[0] || '';

  const filters = {};
  if (sub) filters.sub_category = sub;
  if (model) filters.model = model;

  const exclude = ['Job']; // homepage suggestions should avoid jobs by default

  // Focused latest pool (up-to-date)
  const pFocused = await fetchPool({ category, location, filters, sort: 'latest', limit: 80, excludeCategories: exclude });

  // Trending pool (views_desc)
  const pTrending = await fetchPool({ category, sort: 'views_desc', limit: 100, excludeCategories: exclude });

  // Broad random fallback
  const pRandom = await fetchPool({ sort: 'random', limit: 100, excludeCategories: exclude });

  // Merge and dedupe
  const combined = [];
  const seen = new Set();
  for (const src of [pFocused, pTrending, pRandom]) {
    for (const it of src) {
      const id = Number(it.id);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id); combined.push(it);
    }
  }
  if (!combined.length) return [];

  // Rank
  const q = String(context.query || '');
  const ranked = combined
    .map(it => ({ item: it, score: scoreListing(it, profile, { query: q, focusCategory: category }) }))
    .sort((a, b) => b.score - a.score);

  // Diversify: cap per model_name to avoid over-clustering
  const out = [];
  const modelCount = new Map();
  const limit = Number(context.limit || 12);
  for (const r of ranked) {
    const f = parseListing(r.item);
    const key = (f.model_name || '').toLowerCase();
    const cnt = modelCount.get(key) || 0;
    if (cnt >= 3) continue;
    modelCount.set(key, cnt + 1);
    out.push(r.item);
    if (out.length >= limit) break;
  }

  // Fallback fill from trending if diversity pruning removed too many
  if (out.length < Math.ceil(limit / 2)) {
    for (const it of pTrending) {
      if (out.length >= limit) break;
      const id = Number(it.id);
      if (!Number.isFinite(id) || out.some(x => Number(x.id) === id)) continue;
      out.push(it);
    }
  }

  return out;
}

export async function getSimilarListings(baseListing, limit = 6) {
  const raw = getProfile();
  const profile = applyDecay(raw);
  const f = parseListing(baseListing);

  const filters = {};
  if (f.sub_category) filters.sub_category = f.sub_category;
  if (f.model_name) filters.model = f.model_name;

  const p1 = await fetchPool({ category: f.main_category, location: f.location, filters, sort: 'views_desc', limit: 120 });
  const p2 = await fetchPool({ category: f.main_category, filters, sort: 'latest', limit: 120 });

  const pool = [];
  const seen = new Set();
  for (const src of [p1, p2]) {
    for (const it of src) {
      const id = Number(it.id);
      if (!Number.isFinite(id) || id === Number(baseListing.id) || seen.has(id)) continue;
      seen.add(id); pool.push(it);
    }
  }
  if (!pool.length) return [];

  const ranked = pool
    .map(it => {
      const g = parseListing(it);
      let bonus = 0;
      if (g.sub_category && f.sub_category && g.sub_category === f.sub_category) bonus += 5.0;
      if (g.model_name && f.model_name && g.model_name === f.model_name) bonus += 4.2;
      if (g.location && f.location && g.location.toLowerCase() === f.location.toLowerCase()) bonus += 2.2;
      const overlap = g.tokens.filter(t => f.tokens.includes(t)).length;
      bonus += overlap * 1.4;

      const baseScore = scoreListing(it, profile, {
        focusCategory: f.main_category,
        targetPrice: Number.isFinite(f.price) ? f.price : undefined,
        targetYear: Number.isFinite(f.year) ? f.year : undefined
      });
      return { item: it, score: baseScore + bonus };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.item);

  return ranked;
}

export function buildUserProfile() {
  return getProfile();
}