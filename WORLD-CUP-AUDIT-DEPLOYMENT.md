# Deployment Readiness Audit — World Cup Pool
**Date:** 2026-05-27
**Stack:** SvelteKit 2 + Svelte 5 + Tailwind CSS v4 + PostgreSQL (pg driver)
**Auth:** Session cookies + crypto.scrypt
**Auditor:** Claude Sonnet 4.6

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 3     |
| HIGH     | 6     |
| MEDIUM   | 9     |
| LOW      | 5     |
| **Total**| **23**|

---

## 1. Production Build

### [CRITICAL] Build requires DATABASE_URL at build time
**File:** `src/lib/server/db.ts:3–6`

```typescript
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required but not set');
}
```

SvelteKit's `adapter-node` runs a postbuild analysis phase that imports server modules to determine prerendering. `db.ts` throws synchronously at module load if `DATABASE_URL` is absent. Running `npm run build` without the variable fails with:

```
Error: DATABASE_URL environment variable is required but not set
    at file:///.svelte-kit/output/server/chunks/db.js:4:26
```

CI/CD pipelines that do not inject production DB credentials at build time will fail. The check must be deferred to first use or the early throw must be removed.

**Fix:** Wrap the pool creation in a lazy initializer so the check only fires at runtime:
```typescript
let _pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
	if (!_pool) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL is required');
		_pool = new pg.Pool({ connectionString: url, max: 10 });
		_pool.on('error', (err) => console.error('[db] Idle client error:', err.message));
	}
	return _pool;
}
```

---

### [LOW] Build warnings — accessibility + stale state reference
**Files:**
- `src/routes/profile/+page.svelte:100`, `:104`, `:108` — three `<label>` elements without associated controls (`for` attribute missing)
- `src/routes/+layout.svelte:101` — `data?.user?.is_admin` referenced outside a reactive context; Svelte 5 warns "This reference only captures the initial value of `data`"
- `src/lib/components/PullToRefresh.svelte:38` — `<div>` with touch handlers lacks ARIA role

Build completes with `✓ 213 modules transformed` once `DATABASE_URL` is supplied, but these warnings indicate accessibility regressions and a potential reactivity bug (admin nav tab may not update when user data changes).

---

## 2. Environment Variables

### [MEDIUM] Incomplete env var documentation
**File:** `.env.example`

Only `DATABASE_URL` is documented. The following variables affect production behavior and are completely undocumented:

| Variable | Used in | Effect if missing |
|----------|---------|-------------------|
| `NODE_ENV` | `src/routes/api/auth/[action]/+server.ts:58,76` | Cookie `secure` flag defaults to `false` — session cookies sent over HTTP |
| `API_FOOTBALL_KEY` | `src/lib/server/live-scores.ts:32` | Live score sync disabled silently |
| `PORT` | `build/index.js:237` | Defaults to 3000 |
| `HOST` | `build/index.js:236` | Defaults to 0.0.0.0 |
| `SHUTDOWN_TIMEOUT` | `build/index.js:239` | Defaults to 30 seconds |

**Fix:** Expand `.env.example`:
```bash
# Required
DATABASE_URL=postgresql://user:password@host/db?sslmode=require

# Required in production (enables secure cookies)
NODE_ENV=production

# Optional — enables automatic live score sync
API_FOOTBALL_KEY=your_key_here

# Server (adapter-node defaults)
# PORT=3000
# HOST=0.0.0.0
# SHUTDOWN_TIMEOUT=30
```

---

### [LOW] No `.env.production` template or deployment guide
**File:** `README.md` — is the unedited SvelteKit scaffold template; contains no project-specific instructions, no mention of required env vars, no deployment steps, no migration instructions.

---

## 3. Database Setup

### [CRITICAL] Migrations are not idempotent — no IF NOT EXISTS guards
**Files:** `drizzle/migrations/0001_initial.sql`, `drizzle/migrations/0003_indexes.sql`, `drizzle/migrations/0005_audit_log.sql`, `src/lib/server/migrations/0006_penalty_winner.sql`

Every `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE … ADD COLUMN` runs without an idempotency guard. Running any migration file a second time fails with a PostgreSQL error. Examples:

- `0001_initial.sql:5` — `CREATE TABLE users (…)` — no `IF NOT EXISTS`
- `0001_initial.sql:153–162` — 10× `CREATE INDEX …` — no `IF NOT EXISTS`
- `0003_indexes.sql:2–4` — 3× `CREATE INDEX …` — no `IF NOT EXISTS`
- `0004_scoring_status.sql:2–3` — `ALTER TABLE pools ADD COLUMN …` — no `IF COLUMN NOT EXISTS`
- `0005_audit_log.sql:1` — `CREATE TABLE audit_log` — no `IF NOT EXISTS`
- `0006_penalty_winner.sql:3` — `ALTER TABLE matches ADD COLUMN …` — no `IF COLUMN NOT EXISTS`

Only `0001_initial.sql:144` correctly uses `ON CONFLICT DO NOTHING` for the seed insert.

**Fix:** All `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS`, all `CREATE INDEX` → `CREATE INDEX IF NOT EXISTS`, all `ALTER TABLE … ADD COLUMN` → wrapped in a `DO $$ BEGIN … EXCEPTION WHEN duplicate_column … END $$` block.

---

### [HIGH] No migration runner — migrations must be applied manually
**Files:** `package.json` (scripts section), `drizzle/migrations/`, `src/lib/server/migrations/`

There is no `npm run migrate` script, no automatic startup migration check, and no migration tracking table. `drizzle-kit` is installed but there is no `drizzle.config.ts`, meaning `drizzle-kit push` / `drizzle-kit migrate` cannot be used.

Migration `0006_penalty_winner.sql` is stored in `src/lib/server/migrations/` (a completely different directory from `drizzle/migrations/`) with no tooling to discover or apply it automatically.

On a fresh deployment an operator must manually run 6 SQL files in the correct order against the database. One missed migration crashes parts of the app at runtime (e.g. missing `penalty_winner_id` column will cause silent null returns on scoring queries).

**Fix:**
1. Add a `drizzle.config.ts` and consolidate all migrations under `drizzle/migrations/`.
2. Add `"migrate": "drizzle-kit migrate"` to `package.json` scripts.
3. Or add a startup check in `db.ts` that runs pending migrations automatically.

---

### [MEDIUM] App crashes immediately if DB is unreachable at startup
**File:** `src/lib/server/db.ts:8–11`

```typescript
export const pool = new pg.Pool({
	connectionString: DATABASE_URL,
	max: 10
});
```

`pg.Pool` does not validate the connection string or test connectivity at creation. The first query that fails (which is in `hooks.server.ts` on every request) will throw an unhandled error and SvelteKit will return a 500 with no useful message to the user. There is no startup health verification, retry logic, or circuit-breaker.

---

## 4. Session Management

### [MEDIUM] Cookie `secure` flag depends on undocumented `NODE_ENV`
**File:** `src/routes/api/auth/[action]/+server.ts:58,76`

```typescript
cookies.set('session', token, {
	…
	secure: process.env.NODE_ENV === 'production'
});
```

If `NODE_ENV` is not set to exactly `"production"` in the deployment environment, session cookies are issued without the `Secure` flag. A cookie without `Secure` can be sent over HTTP, exposing session tokens to interception. This is not documented anywhere.

**Fix:** Default to `true` unless explicitly in development:
```typescript
secure: process.env.NODE_ENV !== 'development'
```

---

### [MEDIUM] Session cache has no upper size bound — memory exhaustion risk
**File:** `src/lib/server/cache.ts:112–131`

```typescript
const _sessionCache = new Map<string, TTLEntry<any>>();
```

The map grows without eviction until a token naturally expires (1-minute TTL) or the entry is explicitly deleted. Under sustained load with many unique session tokens, this will exhaust process memory. The `_attempts` map in the auth handler has an explicit cleanup at 10,000 entries; `_sessionCache` has none.

**Fix:** Add LRU eviction or a size cap with random eviction:
```typescript
const SESSION_CACHE_MAX = 5_000;
export function setCachedSession(token: string, user: any): void {
	if (_sessionCache.size >= SESSION_CACHE_MAX) {
		const firstKey = _sessionCache.keys().next().value;
		_sessionCache.delete(firstKey);
	}
	_sessionCache.set(token, { data: user, expiresAt: Date.now() + SESSION_TTL });
}
```

---

### [LOW] Session cleanup only triggers on invalid session, not on a schedule
**File:** `src/hooks.server.ts:27–29`

```typescript
if (now - _lastClean > 60_000) { _lastClean = now; cleanSessions().catch(console.error); }
```

`cleanSessions()` only fires when an unrecognized (expired/deleted) session token is presented. A deployment where all users have valid sessions will never run `DELETE FROM sessions WHERE expires_at < NOW()`. Over 30 days, the `sessions` table will accumulate millions of rows. This will degrade the `WHERE s.token = $1 AND s.expires_at > NOW()` query despite the index.

**Fix:** Add a periodic cleanup independent of invalid-token detection. The simplest approach is a `setInterval` in the server startup hook or a cron endpoint callable by a scheduler.

---

## 5. Error Handling

### [HIGH] `hooks.server.ts` DB query has no try/catch — all requests fail if DB is down
**File:** `src/hooks.server.ts:15–21`

```typescript
const { rows } = await query(
	"SELECT u.id, … FROM users u JOIN sessions s ON … WHERE s.token = $1 AND s.expires_at > NOW()",
	[token]
);
```

No `try/catch` wraps this call. If the PostgreSQL connection is lost (network blip, DB restart, connection pool exhaustion), every single request with a session cookie will throw an unhandled exception. SvelteKit will return a 500 page to the user with no recovery path. Public (unauthenticated) routes will also fail because the hook runs unconditionally.

**Fix:**
```typescript
try {
	const { rows } = await query('SELECT …', [token]);
	user = rows[0] ?? null;
} catch (e) {
	console.error('[hooks] DB error during session lookup:', e);
	// Continue without user — authenticated routes will redirect to /login
}
```

---

### [HIGH] Login action has no try/catch — DB errors return unhandled 500
**File:** `src/routes/api/auth/[action]/+server.ts:68–78`

The `register` block (lines 54–65) has a try/catch that handles duplicate username. The `login` block has none. `authenticateUser()` calls `getUserForAuth()` (a DB query) and `verifyPwd()` (async crypto) — both can throw. A DB error during login returns an unformatted 500 instead of a `{ error: '…' }` JSON response.

---

### [HIGH] 22 server route handlers have no try/catch around DB operations

The following files perform database queries with zero error handling — any DB exception propagates as an unhandled promise rejection, producing a raw 500 response with no structured error body:

| File | Risk |
|------|------|
| `src/routes/api/pools/+server.ts` | `createPool()` (multi-step transaction) throws → unhandled |
| `src/routes/api/pools/join/+server.ts` | `getPoolByInvite()` / `joinPool()` throw → unhandled |
| `src/routes/api/predictions/tiebreaker/+server.ts` | All DB queries unprotected |
| `src/routes/api/auth/change-password/+server.ts` | Password update query unprotected |
| `src/routes/api/admin/reset-password/+server.ts` | Password hash + query unprotected |
| `src/routes/api/admin/pool-settings/+server.ts` | UPDATE query unprotected |
| `src/routes/api/admin/pool-creators/+server.ts` | INSERT/DELETE unprotected |
| `src/routes/api/admin/settings/+server.ts` | UPSERT unprotected |
| `src/routes/api/admin/scoring/+server.ts` | Multi-query update loop unprotected |
| All `+page.server.ts` load functions | Any DB error crashes the page load → 500 |

The minimum fix for each `+server.ts` is:
```typescript
try {
	// … DB operations …
	return json({ ok: true });
} catch (e) {
	console.error('[route] error:', e);
	return json({ error: 'Error interno' }, { status: 500 });
}
```

---

## 6. Static Assets

### [LOW] Service worker is registered but the registration call is commented out
**File:** `src/routes/+layout.svelte:16`

```javascript
// if (browser && 'serviceWorker' in navigator) { navigator.serviceWorker.register('/sw.js').catch(() => {}); }
```

The `sw.js` file exists and is referenced in `static/sw.js` but will never be installed because the registration is commented out. PWA offline capability is non-functional. Either remove `sw.js` entirely or un-comment the registration.

**Static asset completeness:** All icons referenced in `manifest.json` (`/icon-512.svg`, `/icon.svg`) exist in `static/`. No broken references found.

---

## 7. CORS / Security Headers

### [MEDIUM] No security response headers configured
**File:** `src/hooks.server.ts` (no `handleFetch` or header injection)

The application sends no security headers. Attackers can embed the app in iframes (clickjacking), MIME-sniff responses, and there is no Content Security Policy to mitigate XSS:

| Missing Header | Risk |
|----------------|------|
| `Content-Security-Policy` | XSS escalation |
| `X-Frame-Options: SAMEORIGIN` | Clickjacking |
| `X-Content-Type-Options: nosniff` | MIME sniffing |
| `Referrer-Policy: strict-origin-when-cross-origin` | Referrer leakage |
| `Permissions-Policy` | Feature abuse |

**Fix:** Add a `handle` hook that injects headers on all responses:
```typescript
return resolve(event, {
	transformPageChunk: ({ html }) => html,
	filterSerializedResponseHeaders: () => true,
}).then(response => {
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	// Add CSP as appropriate
	return response;
});
```

---

### [LOW] Rate limiting only covers auth endpoints; missing on sensitive mutation routes
**File:** `src/routes/api/auth/[action]/+server.ts:3–19` (rate limiter present)

Auth endpoints (`/api/auth/login`, `/api/auth/register`) are rate-limited to 10 attempts per IP per 15 minutes. However:
- `/api/auth/change-password` — no rate limit
- `/api/admin/reset-password` — no rate limit
- `/api/predictions/*` — no rate limit (a user could spam saves)
- The in-memory rate limiter is per-process and ineffective if multiple Node processes are running (e.g., cluster mode, PM2 with multiple workers)

---

## 8. Docker / Deployment

### [MEDIUM] No Dockerfile or docker-compose — deployment entirely undocumented
**Directory:** `/home/diaktoros/world-cup-pool/` (root)

No `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `Procfile`, or platform-specific config (`railway.json`, `fly.toml`, `render.yaml`, etc.) exists. There is no `start` script in `package.json`. A new deployer must know to run `node build/index.js` with `DATABASE_URL` set — none of this is documented.

The adapter-node build does listen on `0.0.0.0` by default (`build/index.js:236`), so network binding is correct.

**Minimum recommended additions:**

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://placeholder/placeholder npm run build
RUN npm prune --production

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "build/index.js"]
```

`package.json`:
```json
"start": "node build/index.js"
```

---

### [HIGH] No graceful DB pool teardown on shutdown
**File:** `src/lib/server/db.ts` (no shutdown listener), `build/index.js:342–343`

`adapter-node` correctly handles SIGTERM/SIGINT (`process.on('SIGTERM', graceful_shutdown)`). It emits `process.emit('sveltekit:shutdown', reason)` when shutting down. However, the application never calls `pool.end()` to flush and close PostgreSQL connections. In container environments this leaves connections open in the `CLOSE_WAIT` state until the DB server's idle timeout, which can block subsequent deployments or cause connection exhaustion.

**Fix:** Add to `src/hooks.server.ts` or `src/lib/server/db.ts`:
```typescript
process.on('sveltekit:shutdown', async () => {
	await pool.end();
	console.log('[db] Pool closed gracefully');
});
```

---

## 9. Logging

No blocking issues. `console.error` with `[module]` prefixes is used throughout server code. The single `console.log` is in `src/lib/server/seed.ts:118` (a one-time data-seeding script, not production server code).

### [LOW] No structured logging or request access log
All log output is unstructured plain text. In production environments that aggregate logs (Datadog, CloudWatch, Loki), structured JSON logging is strongly preferred. There is also no request-level access log (method, path, status code, duration), making debugging production issues difficult.

**Recommendation:** Use a structured logger (e.g. `pino`) and add a request logging middleware to `hooks.server.ts`.

---

## 10. Graceful Shutdown

`adapter-node` (`build/index.js:292–343`) handles SIGTERM/SIGINT via `graceful_shutdown()`. It stops accepting new connections, waits for in-flight requests, and terminates after `SHUTDOWN_TIMEOUT` seconds (default 30). This is correct.

**Gap:** DB pool is not closed (see §8 above). `setImmediate` background scoring callbacks (`src/routes/api/admin/results/+server.ts:53`, `src/routes/api/admin/sync-scores/+server.ts:23`) may be interrupted mid-loop with no compensation or retry mechanism — partially scored pools will be left in an inconsistent state.

---

## 11. Health Check

### [CRITICAL] No health check endpoint
**File:** No `src/routes/api/health/` directory exists anywhere

There is no `/health`, `/api/health`, `/healthz`, or `/ping` endpoint. In any container-orchestrated deployment (Kubernetes, Docker Swarm, ECS, Railway, Fly.io, Render) the platform requires a health check URL to:
- Determine when a new deployment is ready to receive traffic
- Restart unhealthy containers automatically
- Route load balancer traffic away from degraded instances

Without a health check, zero-downtime deployments are impossible and a crashed app may continue to receive traffic.

**Fix:** Add `src/routes/api/health/+server.ts`:
```typescript
import { json } from '@sveltejs/kit';
import { pool } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		await pool.query('SELECT 1');
		return json({ status: 'ok', db: 'connected' });
	} catch (e) {
		return json({ status: 'error', db: 'unreachable' }, { status: 503 });
	}
};
```

---

## 12. Package.json

### [HIGH] `playwright` in production `dependencies`
**File:** `package.json:34`

```json
"dependencies": {
	…
	"playwright": "^1.59.1",
	…
}
```

`playwright` is a browser automation framework used only for testing. It installs Chromium/Firefox/WebKit binaries (~200 MB total), dramatically bloating the production image and `node_modules`. It belongs in `devDependencies`.

**Fix:** `npm install --save-dev playwright`

---

### [MEDIUM] `drizzle-orm` in production `dependencies` but never used
**File:** `package.json:32`

```json
"dependencies": {
	"drizzle-orm": "^0.45.2",
	…
}
```

All database queries in the app use the raw `pg` driver directly (`src/lib/server/db.ts`, `src/lib/server/queries.ts`, all route handlers). `drizzle-orm` is imported nowhere in `src/`. It is a dead dependency that adds ~3 MB to the bundle and introduces a supply-chain attack surface for no benefit.

Additionally, `drizzle-kit` is in `devDependencies` but there is no `drizzle.config.ts` and no migration script in `package.json` — so it cannot be used for migrations either.

**Fix:** Remove `drizzle-orm` from `dependencies`. Either commit to using it (add `drizzle.config.ts`, convert queries) or remove `drizzle-kit` from `devDependencies` and use a lightweight migration runner.

---

### [MEDIUM] No `start` script in `package.json`
**File:** `package.json:6–15`

```json
"scripts": {
	"dev": "vite dev",
	"build": "vite build",
	"preview": "vite preview",
	"prepare": "svelte-kit sync || echo ''",
	"check": "…",
	"check:watch": "…",
	"test": "vitest run",
	"test:watch": "vitest"
}
```

There is no `"start": "node build/index.js"` script. Platform deployers (Railway, Render, Heroku, etc.) look for `npm start` by convention. Without it, the production start command must be manually configured in every deployment platform's dashboard.

---

### [LOW] `@sveltejs/adapter-auto` is an unused dev dependency
**File:** `package.json:17`

```json
"@sveltejs/adapter-auto": "^7.0.1",
```

`svelte.config.js` uses `@sveltejs/adapter-node` exclusively. `adapter-auto` is installed but never imported, adding to install time and supply-chain surface.

**Fix:** `npm uninstall @sveltejs/adapter-auto`

---

## Prioritized Fix List

### Must-fix before first production deploy (CRITICAL + HIGH blocking)

| # | Severity | Finding | File |
|---|----------|---------|------|
| 1 | CRITICAL | Build fails without `DATABASE_URL` — defer throw to runtime | `src/lib/server/db.ts` |
| 2 | CRITICAL | No health check endpoint | (create) `src/routes/api/health/+server.ts` |
| 3 | CRITICAL | Migrations not idempotent — add `IF NOT EXISTS` guards | `drizzle/migrations/*.sql` |
| 4 | HIGH | `hooks.server.ts` DB query uncaught — all requests 500 if DB down | `src/hooks.server.ts` |
| 5 | HIGH | Login handler no try/catch — DB error returns raw 500 | `src/routes/api/auth/[action]/+server.ts` |
| 6 | HIGH | No migration runner or `npm run migrate` script | `package.json`, migrations |
| 7 | HIGH | `playwright` in production dependencies | `package.json` |
| 8 | HIGH | DB pool not closed on graceful shutdown | `src/lib/server/db.ts` |
| 9 | HIGH | 22 server handlers without try/catch | Various `+server.ts` files |

### Fix before sustained production traffic (MEDIUM)

| # | Severity | Finding | File |
|---|----------|---------|------|
| 10 | MEDIUM | No security response headers (CSP, X-Frame-Options, etc.) | `src/hooks.server.ts` |
| 11 | MEDIUM | `NODE_ENV`, `API_FOOTBALL_KEY` undocumented | `.env.example` |
| 12 | MEDIUM | Cookie `secure` flag depends on undocumented `NODE_ENV` | `src/routes/api/auth/[action]/+server.ts` |
| 13 | MEDIUM | Session cache unbounded — memory exhaustion risk | `src/lib/server/cache.ts` |
| 14 | MEDIUM | No Dockerfile / deployment config | (create) `Dockerfile` |
| 15 | MEDIUM | No `start` script | `package.json` |
| 16 | MEDIUM | `drizzle-orm` unused production dependency | `package.json` |
| 17 | MEDIUM | App crashes with no recovery if DB unreachable at startup | `src/lib/server/db.ts` |
| 18 | MEDIUM | Session cleanup only on invalid session, not scheduled | `src/hooks.server.ts` |

### Nice to have (LOW)

| # | Severity | Finding |
|---|----------|---------|
| 19 | LOW | Build a11y warnings in `profile/+page.svelte` |
| 20 | LOW | `data?.user?.is_admin` stale state warning in `+layout.svelte` |
| 21 | LOW | Service worker registered but registration is commented out |
| 22 | LOW | No structured logging / request access log |
| 23 | LOW | `@sveltejs/adapter-auto` unused dev dependency |
