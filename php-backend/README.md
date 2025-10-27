# Ganudenu PHP Backend (Parity with Node/Express)

This package recreates the Ganudenu backend in PHP 8.1+ with SQLite, matching the existing Node/Express API behavior: routes, request/response JSON, cookies, headers, SSE, and side-effects.

Key goals:
- Exact API parity under /api/*, plus public endpoints (/robots.txt, /sitemap.xml, /uploads/*, OAuth redirects).
- SQLite database with identical tables and PRAGMAs (WAL, synchronous=NORMAL, foreign_keys=ON).
- Auth flows (JWT HS256 + OTP), listings draft/upload/publish/approve, notifications, SSE streams, wanted, users, chats.
- Background jobs via cron/scheduler and rate limiting per route group.
- OpenAPI 3.0 contract provided to verify shape parity.

## Project structure

- public/ — front controller and HTTP routing
- app/Controllers — route handlers
- app/Services — SQLite (PDO), JWT, email, SSE, Gemini, Google OAuth, Facebook poster, rate limiter
- app/Middleware — auth gates
- database/migrations — SQL migrations
- storage/uploads — image files (served via NGINX)
- config/ — app configuration helpers
- scripts/ — migrate, seed, scheduler/background tasks
- tests/ — unit + compatibility tests
- nginx/ — NGINX config snippets
- openapi.yaml — API contract

## Quick start

1) Copy env and set secrets:
   cp php-backend/.env.example php-backend/.env
   Edit GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI, JWT_SECRET, GEMINI_API_KEY, SMTP credentials or EMAIL_DEV_MODE.

2) Create data folders:
   mkdir -p data/uploads data/tmp_ai

3) Run migrations:
   php php-backend/scripts/migrate.php

4) Start PHP built-in server (dev):
   php -S 0.0.0.0:8080 -t php-backend/public

5) Visit health:
   curl http://localhost:8080/api/health

Uploads are served by NGINX in production (see nginx/ganudenu.conf).

## Migrations

- SQL files in database/migrations
- scripts/migrate.php applies PRAGMAs and each migration sequentially
- Mirrors Node runtime CREATE/ALTER logic and indexes

## DEV mode behavior

- EMAIL_DEV_MODE=true → OTPs are logged and returned in JSON (auth endpoints) like Node’s dev behavior.
- Gemini client can operate in mock mode when GEMINI_API_KEY is absent — deterministic extraction/classify logic is used.
- Cookies:
  - auth_token is set httpOnly, secure in production, sameSite=None, path="/", optional domain via PUBLIC_ORIGIN/PUBLIC_DOMAIN.

## Scheduler / Background jobs

Run cron or the PHP scheduler:
- php php-backend/scripts/scheduler.php

Jobs:
- purgeExpiredListings (hourly)
- purgeOldChats (hourly)
- purgeOldWantedRequests (daily)
- sendSavedSearchEmailDigests (every 15 min)

Add a cron like:
*/15 * * * * /usr/bin/php /path/to/repo/php-backend/scripts/scheduler.php --task=sendSavedSearchEmailDigests
0 * * * * /usr/bin/php /path/to/repo/php-backend/scripts/scheduler.php --task=purgeExpiredListings
0 * * * * /usr/bin/php /path/to/repo/php-backend/scripts/scheduler.php --task=purgeOldChats
0 6 * * * /usr/bin/php /path/to/repo/php-backend/scripts/scheduler.php --task=purgeOldWantedRequests

## NGINX config (production)

See nginx/ganudenu.conf for:
- Serving /uploads/ with Cache-Control: public, max-age=31536000, immutable
- Proxying /api/* to PHP-FPM
- SSE: fastcgi_buffering off; increased fastcgi_read_timeout and proxy_read_timeout

## OpenAPI / Compatibility

- openapi.yaml: OpenAPI 3.0 contract for all endpoints.
- tests/compat/ contains golden request/response fixtures from Node; run against PHP endpoints to report diffs.

## Deployment checklist

- Set maintenance mode before cutover (admin API or DB).
- Snapshot database and uploads; run migrations to parity.
- Configure NGINX, PHP-FPM, and cron/scheduler.
- Smoke test: health, auth login with OTP, listings draft/submit, admin approve, SSE streams.
- Rollback plan: switch NGINX upstream back to Node; keep DB backups.

## Config keys (.env)

- DB_PATH → ./data/ganudenu.sqlite
- JWT_SECRET → HS256 signing secret (rotation: maintain previous value in a separate file and accept both)
- GOOGLE_CLIENT_* → OAuth
- GEMINI_API_KEY → AI extraction; absent → mock fallback
- SMTP_* or BREVO_* → email providers
- FB_SERVICE_URL / FB_SERVICE_API_KEY → Facebook poster
- CORS_ORIGINS → whitelist for SPA
- TRUST_PROXY_HOPS → proxied headers trust level

## Intentional notes

- SSE uses heartbeats every 15s with event-stream headers and flushing.
- Image processing attempts WebP conversion; falls back to original when Imagick/GD is unavailable.
- Server-side caching is minimal (APCu if available) for expensive GET endpoints; uploads are cached at NGINX.

## Security checklist

- JWT secret storage and rotation: JWT_SECRET in .env or data/jwt-secret.txt. Rotation plan: introduce NEW_JWT_SECRET and accept tokens signed by both during transition; force reissue via login after rotation window.
- Password hashing with password_hash() (BCRYPT). Argon2id can be enabled if available.
- Input validation and sanitization: file signature checks; SVG blocked; prepared statements everywhere via PDO.
- CSRF mitigation: if using cookie auth only, require Authorization: Bearer for sensitive endpoints or use double-submit token pattern; current flows expect Authorization or header-based X-User-Email where applicable.
- Logs: OAuth callback logs are sanitized (avoid logging code/state/scope).
- Rate limiting: per-group limits configurable via .env; APCu (dev) or file-based fallback included. Use Redis in production if desired.
- File uploads: limited to images, 5MB per file; stored under data/uploads outside webroot; NGINX serves with immutable cache.
- Error handling avoids leaking sensitive data.

## Estimated timeline & resources

Single experienced dev:
- Phase A: Spec + OpenAPI — 2 days
- Phase B: Scaffold + migrations — 2 days
- Phase C: Infra (env, PRAGMAs, rate limits, CORS, NGINX) — 2 days
- Phase D: Auth + OTP + Google OAuth — 3 days
- Phase E: Listings (draft, submit, images, search) — 5 days
- Phase F: Admin flows + approvals + Facebook poster + saved-search + wanted reverse match — 4 days
- Phase G: Notifications + SSE + chats + users + wanted — 3 days
- Phase H: Background jobs + email digests — 2 days
- Phase I: Tests (unit + compat) + rollout docs — 3 days
Total: ~26 days

Two-dev team:
- Parallelize B/D/E/G; reduce total to ~14–16 days.