# Backend Parity Audit: Legacy Node.js vs New PHP

Date: {{today}}
Scope: Compare public API routes and behaviors under:
- Legacy: server -node js (old)/
- New: php-backend/app (Controllers + Router) and openapi.yaml

Summary
- Overall parity is high for Auth, Users (profiles/ratings), Listings (draft -> submit -> listing lifecycle), Notifications, Admin, and Wanted features.
- A few endpoint-level and behavior-level mismatches exist (detailed below).
- One critical bug identified in PHP (ListingsController::myDrafts).
- Several subtle differences around image acceptance, AI-powered inference, and token/header handling.

Key Endpoint Mapping (high level)
- Auth: /api/auth/* implemented in both (OTP flows, Google OAuth, status, reset)
- Users: /api/users/profile, /api/users/rate implemented in both
- Listings: /api/listings/* implemented in both (list, search, filters, suggestions, my, my-drafts, draft, submit, get/:id, delete/:id, report, payment-info/:id, payment-note)
- Notifications: /api/notifications/* implemented in both (plus SSE)
- Admin: /api/admin/* implemented in both (config, pending, approvals, banners, maintenance, backup/restore, prompts, metrics, users moderation)
- Wanted: /api/wanted/* implemented in both
- Chats: /api/chats/* implemented in both

Critical Issues (needs fix)
1) PHP ListingsController::myDrafts uses broken token retrieval
   - File: php-backend/app/Controllers/ListingsController.php
   - Snippet:
       public static function myDrafts(): void
       {
           self::ensureSchema();
           $email = null;
           BearerToken();
           $v = $tok ? JWT::verify($tok) : ['ok' => false];
           ...
   - Problems:
     - Calls BearerToken() with no namespace and no assignment; $tok is undefined.
     - As written, endpoint will fatal or always 401.
   - Node behavior:
     - GET /api/listings/my-drafts accepts bearer auth via requireUser (JWT) OR X-User-Email and filters optionally by employee_profile.
   - Recommended fix (PHP):
     - Replace with the pattern used in ListingsController::my():
       - Try bearer: $tok = JWT::getBearerToken(); $v = JWT::verify($tok)
       - If bearer fails, accept X-User-Email header as fallback
       - Support optional ?employee_profile=1

Behavioral Mismatches (non-breaking but different)
2) Auth status allows cookie in PHP
   - Node: /api/auth/status only checks Authorization: Bearer token; returns 401 if missing/invalid.
   - PHP: status checks Bearer; if missing, also accepts auth_token cookie.
   - Impact: PHP is more permissive and SPA can rely on cookie-only in some flows.

3) Google OAuth flow: PKCE and diagnostics in PHP
   - Node: Standard Authorization Code flow (no PKCE); state includes r (return).
   - PHP: Implements PKCE (S256), stores verifier in an HttpOnly cookie, and includes a diagnostic endpoint (googleDebug-style via controller method). Also stricter redirect URI validation and more detailed error hints.
   - Impact: Safer and more robust, but slight differences in setup requirements (redirect URI exactly /api/auth/google/callback, dev port guidance).

4) Listings vehicle-specs endpoint output
   - Node: /api/listings/vehicle-specs calls Gemini, returns normalized keys such as manufacturer, engine_capacity_cc, transmission, fuel_type, colour, mileage_km with numeric coercions and bounds.
   - PHP: /api/listings/vehicle-specs uses simple heuristics and returns a reduced/alternate set of keys (e.g., 'engine', 'fuel_economy', 'doors') that does not match Node schema.
   - Impact: Client code expecting Node keys will break against PHP.
   - Recommendation: Align PHP response schema/keys and normalization with Node.

5) Listings image acceptance rules
   - Node: Accepts image/* via multer; explicitly blocks SVG; then best-effort magic checks. Allows formats like JPEG, PNG, WEBP, GIF, AVIF, TIFF by mimetype and passes through sharp -> WebP.
   - PHP: Explicit magic-number checks restrict to JPEG, PNG, WEBP only; rejects GIF/AVIF/TIFF. Blocks SVG explicitly.
   - Impact: Users uploading GIF/AVIF/TIFF that previously worked in Node may fail in PHP.
   - Recommendation: Either widen acceptance to match Node (and re-encode to WebP) or document narrowed support.

6) Listings “my-drafts” authentication handling
   - Node: Uses requireUser middleware (JWT Bearer) but many “owner” endpoints also accept X-User-Email header; /my-drafts supports employee_profile filter via query and header-based auth.
   - PHP: Intended to use Bearer-only in myDrafts (and currently broken per issue #1). ListingsController::my supports Bearer or X-User-Email fallback, which is closer to Node behavior.
   - Recommendation: Make myDrafts mirror my: accept Bearer, fallback to X-User-Email; support ?employee_profile; fix the token bug.

7) Listings draft-image add/delete endpoints
   - Node: Draft images are created during /api/listings/draft upload; no distinct endpoints exist for add/delete beyond deleting a whole draft (/api/listings/draft/:id DELETE).
   - PHP: Adds endpoints to add/remove images after draft creation:
     - POST /api/listings/draft/{id}/images (draftImageAdd)
     - DELETE /api/listings/draft/{id}/images/{imageId} (draftImageDelete)
   - Impact: Additional capability in PHP; clients unaware of them won’t break, but parity is not exact.
   - Recommendation: Document as enhancement, or add Node equivalents if needed.

8) Listings “describe” and AI prompts
   - Node: Uses Gemini with explicit prompts and strict fence/JSON stripping to return enhanced description. Strong normalization in normalizeStructuredData and multiple AI inferences for category, specs, price, etc.
   - PHP: Uses GeminiService abstractions with simpler fallbacks; transformations may not perfectly match Node’s normalizeStructuredData outcomes (e.g., sub_category normalization, price parsing for “k/lakh/mn”).
   - Impact: Minor differences in auto-filled fields; may affect validation at submit step.
   - Recommendation: Port Node normalization logic or update GeminiService to ensure identical fields (pricing_type defaults, +94 phone extraction, vehicle sub-category coercions, etc.).

9) Caching strategy
   - Node: In-memory micro-cache for selected GET endpoints (e.g., listings list/search/filters/suggestions/payment-info) with Cache-Control headers.
   - PHP: Sets Cache-Control but does not implement in-memory caching; relies on DB-only.
   - Impact: Performance differences under load. Not a functional mismatch.

10) Cookie domain and CORS behavior
   - Both: set SameSite=None; Secure in production only; compute cookie domain from PUBLIC_ORIGIN/PUBLIC_DOMAIN.
   - PHP: Adds logic to avoid setting domain for localhost/IP (host-only cookie), includes broader CORS whitelist (prod domain, PUBLIC_ORIGIN, localhost).
   - Impact: PHP is slightly more resilient in mixed dev/prod environments.

11) Listings OG/thumbnail generation
   - Node: Generates OG image with text overlay SVG compositing and a thumbnail; also per-image 1024px “medium” variants.
   - PHP: Generates simpler OG/thumbnail (if Imagick available); no per-image “medium” variant (often null).
   - Impact: Client relying on medium variants may see differences; Node falls back to first image path if medium missing, PHP mirrors this behavior partially when returning small_images/thumbnail_url.

12) Endpoint parity gaps (observed)
   - Node-only:
     - /api/listings/debug/temp-extract (dev flag DEBUG_TEMP_EXTRACT=true)
   - PHP-only:
     - /api/auth/google/debug (via AuthController::googleDebug), draft image add/delete endpoints noted above.
   - Impact: Dev tooling differences only.

Smaller Differences (low risk)
- AuthController::status: both now return 401 on missing/invalid, but PHP additionally supports cookie-based token pickup.
- Payment-info: Both compute defaults per category; PHP combines split bank fields into bank_details when needed (backward compatibility).
- Notifications/SSE: Parity appears complete; PHP may have minor differences in rate limits (Router rate groups use default env seeds).

Recommendations
A) Fix critical my-drafts auth bug in PHP
   - Implement same auth fallback as ListingsController::my (Bearer token first, fallback to X-User-Email).
   - Ensure ?employee_profile filter parity (true/1/yes) and response normalization (boolean employee_profile).

B) Align /api/listings/vehicle-specs schema
   - Return Node-style keys with normalization and limits: manufacturer, engine_capacity_cc, transmission, fuel_type, colour, mileage_km.
   - If Gemini not available, at least match keys with null/defaults rather than alternate names.

C) Consider widening acceptable image formats
   - Match Node acceptance (mimetype-based) while keeping SVG hard-block and magic checks for safety.
   - Always re-encode to WebP for storage as now.

D) Port Node normalizeStructuredData details
   - Sub-category coercions for Vehicle, string-to-number price (k/lakh/mn), +94 phone parsing, manufacture_year bounds, pricing_type defaults, Job-specific fields.
   - This will reduce friction at /submit validation time.

E) Document intentional enhancements/non-parity
   - New PHP capabilities: draft image add/delete, Google OAuth PKCE, cookie fallback in status.
   - Dev endpoints: googleDebug in PHP vs temp-extract in Node.

F) Optional: Re-introduce lightweight in-memory caches
   - For high-traffic GETs: listings list/search/filters/suggestions/payment-info. Use TTLs identical to Node for parity (15–60s).

Appendix: Files reviewed
- Node routes:
  - server -node js (old)/routes/auth.js
  - server -node js (old)/routes/users.js
  - server -node js (old)/routes/listings.js
  - Plus structure for admin/notifications/chats/wanted (not exhaustively diffed here)
- PHP controllers:
  - php-backend/app/Controllers/AuthController.php
  - php-backend/app/Controllers/UsersController.php
  - php-backend/app/Controllers/ListingsController.php
  - php-backend/app/Router.php
  - php-backend/app/bootstrap.php
  - php-backend/openapi.yaml

Notes
- This report focuses on externally observable behaviors and obvious code-path differences. Deeper parity checks for Admin, Wanted, Chats, Notifications were sampled via openapi.yaml and controller presence; a full test run against both backends is recommended.