# AUDIT-GENERAL-OPINION.md

General code review of the World Cup 2026 prediction pool app. Read on 2026-05-28 against branch `master` at `132cdf7`.

Stack reviewed: SvelteKit 2 + Svelte 5 + Tailwind v4 + raw `pg` against Neon. 94 source files in `src/`, ~21k lines including tests.

What follows is brutally honest — opinions are tagged `OPINION`. Severity uses CRITICAL/HIGH/MEDIUM/LOW/OPINION.

---

## 1. CRITICAL findings

### C1 — Toast UI never renders despite being called
**Category:** Frontend / Code quality · **File:** `src/lib/toast.ts:1-10`, `src/routes/pool/[id]/bracket/+page.svelte:438-542`, `src/routes/pool/[id]/predict/+page.svelte:216`

`showToast()` writes to a `writable('')` store, but no `<Toast/>` component, no `+layout.svelte` block, and no other file ever subscribes to `$toast`. A grep for `$toast` and `from '$lib/toast'` only finds the *callers*, not the renderer. So every `showToast('✓ Guardado')` in the bracket save path silently does nothing, and the error toast in `predict/+page.svelte` on save failure is invisible. The `.toast` CSS class in `app.css:20-30` is dead.

**Fix:** Either render the store in `+layout.svelte` (e.g. `{#if $toast}<div class="toast">{$toast}</div>{/if}`) or delete the file and inline the SvelteKit `enhance` callbacks. The current state is a UX regression hiding behind the appearance of feedback.

---

### C2 — `Pool` type lies about column names; runtime depends on `data.pool.allow_multiple_predictions` while the type says `allow_multiple`
**Category:** Architecture / Type safety · **File:** `src/lib/server/types.ts:11-26`, `src/routes/pool/[id]/predict/+page.svelte:15`

```ts
// types.ts
export interface Pool {
  ...
  allow_multiple: boolean;       // ← wrong column name
  ...
  status: string;                // ← no such column in the DB
  ...
}
```
But `0001_initial.sql` declares `allow_multiple_predictions BOOLEAN DEFAULT FALSE`, and predict page reads `data.pool.allow_multiple_predictions`. The interface is a fiction — TypeScript narrows nothing useful here and would let any property access compile silently because the rows are cast `as Pool` from `query()` which returns `unknown[]`.

`status` doesn't exist in `pools` at all; if a route reads `pool.status` TS won't complain. Add it, miss the actual column you wanted (`is_active`?), ship the bug.

**Fix:** Generate types from the live schema (drizzle-kit introspect, pg-typegen, etc.) or at minimum hand-update this file to match the migrations. Today the type system is providing negative value: it gives false confidence.

---

### C3 — `db.ts` shutdown handler nulls `_pool` mid-flight
**Category:** DB / Code quality · **File:** `src/lib/server/db.ts:28-43`

```ts
async function shutdown() {
  if (_pool) {
    try { await _pool.end(); ... } catch ...
    _pool = null;            // ← danger
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

If a request is in flight when SIGTERM arrives, that request still holds a `pg.PoolClient` and may call `query()` after `_pool` is nulled — `getPool()` will then *create a new pool* against an env DB URL we are explicitly trying to drain. The "graceful shutdown" can paradoxically open new connections to a database we're disconnecting from.

**Fix:** Set a `_shuttingDown` flag, reject new `getPool()` calls with a 503, and don't recreate the pool. Or simply omit the `_pool = null` line so future `query()` calls correctly throw against the closed pool.

---

## 2. HIGH findings

### H1 — `/api/predictions/match-scores` swallows scoring failures behind 200 OK
**Category:** API design / Reliability · **File:** `src/routes/api/predictions/match-scores/+server.ts:138-149`

```ts
try {
  await calculateAllScores(poolId);
  ...
} catch (e) {
  console.error('[score] match-scores pool', poolId, e);
  return json({ ok: true, scoring: 'failed' });
}
```
`ok: true` while `scoring: 'failed'`. No client does anything with this shape — both `predict` and `bracket` save flows read `if (res.ok)` and call it a success. So a scoring exception (broken advisory lock, schema drift, deadlock) is silently lost: the row is saved with `points_earned = 0` (forced by the `ON CONFLICT … SET points_earned = 0`), the leaderboard becomes wrong, and nobody finds out until a user complains.

**Fix:** Either treat scoring as a hard dependency and return 500 (clients can show "saved but scoring delayed"), or queue a real retry. The current shape is the worst of both: caller can't distinguish success from silent failure.

---

### H2 — Bracket "preceding-phase" consistency check depends on object-iteration order
**Category:** Code quality · **File:** `src/routes/api/predictions/bracket/+server.ts:168-207`

```ts
const precedingCache: Record<string, Set<number>> = {};
async function getPrecedingTeams(precedingPhase: string) {
  if (precedingCache[precedingPhase]) return ...
  const inBody = picks[precedingPhase];
  if (inBody) { precedingCache[...] = new Set(...); return ... }
  ...DB fallback...
}

for (const [phase, slots] of Object.entries(picks)) {
  const precedingPhase = PHASE_PROGRESSION[phase];
  ...
  const teamsInPrecedingPhase = await getPrecedingTeams(precedingPhase);
  if (teamsInPrecedingPhase.size === 0) continue;   // ← skip rule entirely
  ...
}
```
Two problems:
1. If the client sends `{ final: {...} }` but not `sf`, the code hydrates `sf` *from the DB* — i.e. checks new finals against an old DB state instead of against what the client *just* sent. If the client posts `sf` first and then `final` in two separate requests, the rule works; if combined in one request and `sf` is empty, the final is silently un-checked because of the `size === 0 ⇒ skip` bypass at line 198.
2. `Object.entries` order is insertion order in practice but the rule semantically wants `r32 → r16 → qf → sf → final/3rd`. Sort the keys before iterating; or better, iterate `PHASE_PROGRESSION` keys explicitly.

**Fix:** Iterate phases in the canonical order, and treat "no preceding data anywhere" as a 400 instead of a silent skip when the user is actually saving a downstream phase.

---

### H3 — Inline rescoring is fire-and-forget with `setImmediate` and no retry
**Category:** Reliability / Architecture · **File:** `src/routes/api/admin/results/+server.ts:69-80`, `src/routes/api/admin/sync-scores/+server.ts:43-62`

```ts
setImmediate(async () => {
  for (const poolId of poolIds) {
    try { await calculateAllScores(poolId); ... }
    catch (e) { console.error(...); }
  }
  invalidateGlobalLeaderboard();
});
return json({ ok: true, scoring: 'pending' });
```
This is a homegrown background job runner. There is no retry, no dead-letter, no observability beyond `console.error`, and if the Node process dies between the response and the loop completing, pools 7..N never get rescored. Pools can be left with stale `total_score` for hours until the next admin action triggers another sweep.

**Fix:** Either rescore synchronously (the advisory lock + bulk UPDATEs in `scoring.ts` are already fast — likely <1s per pool), or stand up a real job queue. The dual standards between match-scores (synchronous) and admin/results (async) is itself surprising and suggests one of the two is the wrong default.

---

### H4 — `hooks.server.ts` CORS check collapses scheme into hostname, weakening origin enforcement
**Category:** Security / API design · **File:** `src/hooks.server.ts:30-46`

```ts
const normalize = (u: string) => {
  ...
  // "scheme doesn't matter."
  return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
};
```
Comment says scheme doesn't matter, but it does: an attacker on the same LAN running an HTTP-served `<form>` on the same host:port as a future HTTPS deployment passes the check. In dev this is fine; for any production deployment behind TLS this should be tightened.

Also, when `origin` is `null` the code falls through to "allowed". A `<form>` POST from a same-origin page sends no `Origin` header in some browsers; relying on `sameSite=lax` is fine, but make the comment explicit that this is the only thing protecting JSON endpoints from same-site CSRF in that case.

**Fix:** Compare `url.origin` directly (scheme + hostname + port). When `secure: process.env.NODE_ENV !== 'development'` is set on the session cookie, you've already committed to HTTPS in prod — match the policy here.

---

### H5 — Module-level rate-limit maps will be useless once you scale, and the boot-time guard in `cache.ts` doesn't cover them
**Category:** Architecture / Security · **File:** `src/lib/server/rate-limit.ts`, `src/routes/api/auth/[action]/+server.ts:10-26`, `src/hooks.server.ts:13`

`cache.ts` refuses to boot when it detects `VERCEL`/`RAILWAY_REPLICA_COUNT`/`FLY_APP_REPLICAS` — but `rate-limit.ts` and the auth-route IP limiter use the same kind of in-process Maps and don't participate in that guard. If `ALLOW_MULTI_INSTANCE_CACHE=1` ever flips (which it must, the moment you outgrow one box), session caching breaks loudly *and* rate limits become per-instance silently.

Also: `_lastClean` in `hooks.server.ts:13` is a per-instance "expire sessions" trigger. With N instances, you get N cleanups per minute against the same `sessions` table.

**Fix:** Move rate limiting and cleanup-scheduling into the same boot-guard cluster, or push them to Postgres (an `INSERT … ON CONFLICT` against a `rate_limits(key, count, reset_at)` table is fine for the load you're describing).

---

### H6 — Default scoring rules are defined in two places and will drift
**Category:** Code quality / Architecture · **File:** `src/lib/server/queries.ts:91-103`, `src/lib/server/scoring.ts:4-15`

The defaults inserted at pool creation (`queries.ts:createPool`) and the defaults applied as fallback when a `scoring_config` row is missing (`scoring.ts:DEFAULT_RULES`) are *separate literal blocks*. They currently agree, but the next person who edits one will forget the other. Worse: the rule key `third_place` is in the middle of the queries.ts list and at the bottom of the scoring.ts object, so a diff won't catch it.

**Fix:** Define once (e.g. `DEFAULT_SCORING_RULES` in `scoring.ts`), import in `queries.ts:createPool` and iterate.

---

### H7 — `seed.ts` runs its top-level `seed()` on every import
**Category:** Code quality · **File:** `src/lib/server/seed.ts:131-136`

```ts
seed()
  .then(() => process.exit(0))
  .catch((err) => { ...; process.exit(1); });
```
If anything imports this file (e.g. a stray `import` left in by mistake, or `tsx` discovering it via path), the dev server `process.exit(0)`s. Guard with `if (import.meta.url === \`file://${process.argv[1]}\`)` or at minimum a `main` function pattern.

---

### H8 — `flag()` / `flagEmoji()` / `shortName()` duplicated across components with subtle drift
**Category:** Code quality / DRY · **File:** `src/routes/pool/[id]/+page.svelte:27-34`, `src/routes/pool/[id]/predict/+page.svelte:327-344`, `src/routes/pool/[id]/bracket/+page.svelte:576-599`

Three near-copies of `flagEmoji`:
- `+page.svelte` returns `''` for missing code (no fallback emoji).
- `predict/+page.svelte` returns `'🏳️'` for unknown length but no `console.warn`.
- `bracket/+page.svelte` returns `'🏳️'` AND emits a `console.warn`.

`shortName` lookup tables are 80% the same but the bracket variant has `'Ivory Coast': "Côte d'Ivoire"` and also `name.substring(0, 14)` as a fallback (silent truncation — "Czech Republ"); the others don't.

**Fix:** Move to `$lib/teams.ts` once. The same logic should apply on every screen so that "United States" is "USA" everywhere or nowhere.

---

### H9 — Currency hardcoded to `€` on the home page despite per-pool `currency` column
**Category:** Frontend / Bug · **File:** `src/routes/+page.svelte:67`, `:83`

```svelte
{pool.buy_in > 0 ? ` · ${pool.buy_in}€` : ''}
```
But `pools.currency` is a real column (default `'EUR'`) and `createPool` accepts a custom value. Any pool with `currency='USD'` will still display `5€`. Either remove the per-pool field, or render `pool.currency` symbol consistently.

---

### H10 — Page does not guard against deadline-passed edits *server-side* on the bracket page; relies on `effectivelyLocked` client-side
**Category:** Security · **File:** `src/routes/pool/[id]/bracket/+page.svelte:29` (client lock), `src/routes/api/predictions/bracket/+server.ts:91-123` (server lock)

The server-side bracket endpoint checks pool deadline and per-phase "started" matches and *silently filters* started phases out (`delete (picks as Record<...>)[p]`). It does not return an error. A client racing the deadline could keep posting; some phases save, some silently drop, no signal to the UI.

**Fix:** Return a 409 (or 200 with explicit `dropped: ['r16']`) so the UI can roll back the optimistic update. Silent filtering is a "user thought they saved" hazard.

---

## 3. MEDIUM findings

### M1 — Schema has no CHECK constraints on integer/text domain values
**Category:** Database · **File:** `drizzle/migrations/0001_initial.sql`

`home_score`, `away_score`, `points_earned`, `total_score` are all `INTEGER` with no `>= 0` check. `phase TEXT`, `status TEXT`, `currency TEXT` are all unchecked free text. The app validates this in 6+ places (e.g. `match-scores/+server.ts:84-99`, `admin/results/+server.ts:22-28`) but a direct SQL update or future endpoint could write `-1`.

**Fix:** Add `CHECK (home_score >= 0 AND home_score <= 30)` and an enum-style `CHECK (phase IN ('group','r32',…))` or a `CREATE TYPE` enum. Belt and suspenders.

---

### M2 — `idx_pools_is_active` is on a low-cardinality boolean
**Category:** Database · **File:** `0001_initial.sql:161`

For a boolean with two values, a btree index is almost always worse than a sequential scan unless the table is huge and skewed. Pools are unlikely to grow beyond hundreds. Either drop it or make it a partial index: `CREATE INDEX … ON pools(...) WHERE is_active = true` — which is what you actually query for.

---

### M3 — Missing index for the leaderboard sort
**Category:** Database / Perf · **File:** `0001_initial.sql`, query in `queries.ts:222-231`

`getPoolLeaderboard` does `ORDER BY total_score DESC, updated_at ASC` over `predictions WHERE pool_id = $1`. There is `idx_predictions_pool` but not a composite `(pool_id, total_score DESC, updated_at ASC)`. With 50 users × 1 pool it's a non-issue; with the public/global leaderboard at the end of the tournament it matters.

---

### M4 — `audit_log.old_value` / `new_value` are `TEXT`, queries always `JSON.stringify`
**Category:** Database · **File:** `0005_audit_log.sql`, `audit.ts:9-11`

Should be `JSONB` so future filtering (`WHERE new_value->>'home_score' > '5'`) is possible. Cheap migration today; painful later.

---

### M5 — `group_predictions` schema is denormalized 4-column "ranking"
**Category:** Database / Architecture · **File:** `0001_initial.sql:90-100`

`position_1 … position_4` columns make it impossible at the DB layer to enforce "no duplicate teams within the same group". The API validates this (`api/predictions/group/+server.ts:124-131`), but two parallel writers could each pass validation independently and produce a `(A→Brazil, B→Brazil)` row across rows (intentional design lapse: cross-row duplicate detection across columns is hard).

A cleaner shape is `group_prediction_picks(prediction_id, group_name, position, team_id)` with `UNIQUE(prediction_id, group_name, team_id)` *and* `UNIQUE(prediction_id, group_name, position)`. Then "no dup teams" is an index, not validation code.

---

### M6 — `tiebreaker` is a 1:1 sidecar table
**Category:** Database / Code quality · **File:** `0001_initial.sql:132-137`

`tiebreaker.home_score` and `away_score` could just be columns on `predictions`. A row with 1:1 FK + UNIQUE on `prediction_id` is a join you never wanted. Saves a query, simplifies the load function.

---

### M7 — `site_settings` is a key-value table holding exactly one row
**Category:** Database · **File:** `0001_initial.sql:140-145`

`can_create_pools` is the only key. Either commit to a settings table with real use cases or replace with an environment variable. Right now it's premature abstraction with extra IO.

---

### M8 — Migration files are split across two directories with no documented reason
**Category:** Architecture · **File:** `drizzle/migrations/` (0001-0008 except 0006), `src/lib/server/migrations/0006_penalty_winner.sql`

`migrate.ts` works around this with a dedupe pass. Why is 0006 the lone migration in a different directory? If a future contributor adds `0006_something_else.sql` to `drizzle/migrations/`, the dedupe-by-filename hides one. This is an accident waiting to happen.

**Fix:** Pick one directory. Move the existing file. Delete the dedupe pass.

---

### M9 — `migrate.ts` runs each SQL file as a single `pool.query` with one transaction wrapping it
**Category:** DB / Architecture · **File:** `src/lib/server/migrate.ts:98-108`

`pg`'s `pool.query(sql)` over a multi-statement string works, but each migration acquires a different pooled connection across the `BEGIN`/migration/`INSERT`/`COMMIT` calls. `BEGIN` on connection A, the migration runs on connection B, `COMMIT` on connection C — all your "atomic" migrations are effectively auto-committed. The `BEGIN`/`COMMIT` is theater.

**Fix:** `const client = await pool.connect(); try { await client.query('BEGIN'); … }` so the transaction is bound to one connection.

---

### M10 — `pool/[id]/+page.server.ts` returns 18 fields including 5 redundant ones
**Category:** Code quality · **File:** `src/routes/pool/[id]/+page.server.ts:227-241`

`teams`, `groupPreds`, `bracketPreds`, `userGroupPredsFull`, `userBracketPredsFull`, `resultsTeamCache`, `resultsPhases`, `resultsGroupStandings` — lots of overlap. `teams` and `resultsTeamCache` are both team-id-keyed maps and almost always identical. The "Full" variants reload the same data with one extra column. Each is fetched in a separate SQL call.

This file does ~10 separate `query()` calls, much of it serial. It also reads `predictions[0]` twice. Consider:
- A single Promise.all over the parallel-safe queries.
- Drop `userGroupPredsFull`/`userBracketPredsFull`: they're a strict superset (with extra column) of `groupPreds[predictions[0].id]`. Reuse.

---

### M11 — `pool/[id]/+page.server.ts` caches **predictions and tiebreakers** in `getCachedPoolResults` adjacent to non-user data
**Category:** Security · **File:** `:139-208`

The §3.2 comment correctly warns "DO NOT add user-scoped fields here". Today only tournament-wide data is cached. But the function is huge and there's nothing preventing a future contributor from spreading more data into the cached object. The comment is load-bearing — it shouldn't be.

**Fix:** Wrap the cached payload in a typed shape (`PoolResultsCache`) at the cache layer, and assert in `setCachedPoolResults` that it has no `userId`/`prediction_id`/`predictions` keys.

---

### M12 — Spinner CSS animation `spin` is referenced but `@keyframes spin` is undefined
**Category:** Frontend / Bug · **File:** `src/lib/components/PullToRefresh.svelte:43`, `src/app.css`

```svelte
<svg ... style="animation:spin 0.8s linear infinite;">
```
Grep confirms `@keyframes spin` is not in `app.css` or anywhere else in the source. The spinner just sits there. Either Tailwind v4 provides one globally (worth verifying) or this is a broken affordance.

---

### M13 — `+layout.svelte` directly walks the DOM with `document.querySelectorAll`
**Category:** Svelte 5 patterns · **File:** `src/routes/+layout.svelte:65-86`

```js
function stagger() {
  document.querySelectorAll('.pool-card:not(.stagger-in), …').forEach(el => { ... });
  document.querySelectorAll('.stat-value[data-count]…').forEach(el => { ... });
}
$effect(() => {
  $page;
  setTimeout(stagger, 100);
});
```
This is an anti-pattern in Svelte 5. The 100ms timeout is fragile (race with slow loads), the `stagger-in` class is mutated outside the rune system, and `$page;` as a "trigger" is opaque. Use a per-card `in:fade={{ delay: i*60 }}` transition on the templates that render them.

---

### M14 — `isDark = $state(true)` then immediately overwritten by `$effect` reading the DOM
**Category:** Svelte 5 patterns / UX · **File:** `src/routes/+layout.svelte:26-30`

```js
let isDark = $state(true);
$effect(() => {
  if (!browser) return;
  isDark = document.documentElement.getAttribute('data-theme') !== 'light';
});
```
The initial render shows the dark-mode 🌙/☀️ icon for one frame before the effect runs and corrects it. The reliable fix is to set the attribute in `app.html` from `localStorage` via an inline script before the body renders (a tiny FOUC-prevention script). Then `isDark` is initialized from the *actual* state on first paint.

Also: theme isn't part of `data` returned from `+layout.server.ts`, so SSR can't help. Either store it in a cookie and SSR it, or accept the flash on first paint of new sessions.

---

### M15 — `selections = JSON.parse(JSON.stringify(selectionsInit))` on every `data` change clobbers in-flight edits
**Category:** Svelte 5 / UX · **File:** `src/routes/pool/[id]/predict/+page.svelte:62-64`, `:263-264`

```js
let selections = $state({});
$effect(() => { selections = JSON.parse(JSON.stringify(selectionsInit)); });
```
`selectionsInit` is `$derived` from `data.existingGroupPreds`. The save flow `POST`s and *doesn't* `invalidateAll`. But every other parent navigation that does invalidate (e.g. entry switch) re-runs this effect and resets the user's local state to whatever the server returned — which on a slow save round-trip could be the *pre-save* value. There's a narrow race window where typing during the round-trip is silently reverted.

**Fix:** Track which keys have been locally edited and merge, or invalidate only after the save resolves and accept the round-trip latency.

---

### M16 — Body parsing has no `try/catch`; any malformed JSON crashes the route with a 500 missing the correlation code
**Category:** API design · **File:** every `+server.ts` that does `const body = await request.json()`

E.g. `api/predictions/group/+server.ts:57`, `api/predictions/bracket/+server.ts:55`, `api/auth/[action]/+server.ts:44`. A POST with `Content-Type: application/json` and body `garbage` rejects with an uncaught `SyntaxError`, SvelteKit returns its default 500 HTML. Easy to wrap once via a helper or set the route option `parsers`.

---

### M17 — Random correlation codes use `Math.random()` and aren't applied uniformly
**Category:** API design · **File:** `api/predictions/group/+server.ts:40-44`, `api/predictions/bracket/+server.ts:38-42, 231-235`, `api/admin/sync-scores/+server.ts:67-71`, `api/admin/results/+server.ts:84-88`

`Math.random().toString(36).slice(2, 10)` collides ~once per ~1.4M codes; fine for correlation, but inconsistent: half the routes emit them, half don't. Centralize the wrapper:

```ts
function errCode() {
  return `ERR_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}
```
Adopt it everywhere or nowhere.

---

### M18 — `api/auth/[action]` is one endpoint multiplexing login/register/logout via URL param
**Category:** API design · **File:** `src/routes/api/auth/[action]/+server.ts`

This is the wrong abstraction. Each verb has different validation, different rate-limit semantics, different success responses (logout 303 redirects; the others 200 JSON). Mixing them creates the `if (action === 'login' || action === 'register')` rate-limit fork at the top and the `if (action === 'logout')` branch that needs a different code path entirely. Split into `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`.

---

### M19 — `hooks.server.ts` public-paths matches by prefix, including `/api/auth/change-password`
**Category:** Security / Code quality · **File:** `src/hooks.server.ts:12`, comment at `:6-11`

The comment acknowledges this is "not a security hole — just a documentation note." But the comment itself is the smell. If you have to document that a security check is being bypassed for a route that happens to self-defend, that's footgun-shaped. The clean approach is `publicPaths` of exact strings (`/api/auth/login`, `/api/auth/register`, `/api/auth/logout`) or a separate `publicApiPaths` set.

---

### M20 — Inline styles everywhere
**Category:** Frontend / Maintainability · **File:** `src/routes/+layout.svelte`, `src/routes/+page.svelte`, `src/routes/login/+page.svelte`, `src/routes/pool/[id]/+page.svelte`, basically all Svelte files

Sample from `+layout.svelte:142-148`:
```svelte
<div style="width: 36px; height: 36px; background: linear-gradient(135deg, var(--gold), #b8943f); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px;">🏆</div>
```
The project uses Tailwind v4 yet uses almost no utility classes — instead it has thousands of inline styles. Pick a lane:
- If Tailwind, rewrite to `class="w-9 h-9 bg-gradient-to-br …"`.
- If hand-rolled CSS, move these into named classes in `app.css`.

The inline-style maximalist approach makes dark/light theme support (M21) much harder and is invisible to your CSS minifier.

---

### M21 — Light-mode polish is uneven
**Category:** Design / UX · **File:** `app.css:70-89`, route components

The CSS variable system for `:root[data-theme="light"]` is solid in `app.css`, but countless inline styles in components hardcode dark colors (`rgba(255,255,255,0.03)`, `#3d2a00`, etc.) — those don't react to the theme attribute. In light mode the bracket page and predict page will have islands of dark color. Audit each `rgba(255,255,255,…)` and replace with a CSS variable.

---

### M22 — Accessibility: font-size 8-9px and high letter-spacing
**Category:** Design / A11y · **File:** `app.css:198, 254, 397, 399`

```css
.bottom-nav a { font-size: 8px; ... }
.nav-label { font-size: 9px; letter-spacing: 0.05em; ... }
.stat-label { font-size: 9px; letter-spacing: 0.12em; ... }
```
Both under WCAG SC 1.4.4 reasonable minimum and difficult for anyone with mild vision impairment. WCAG doesn't mandate a pixel minimum but 8-9px with `letter-spacing` is functionally illegible on most phones. The aesthetic is doing real damage to usability.

---

### M23 — `transition: all 0.2s` and pervasive `transform: translateY(-2px)` on hover
**Category:** Frontend / Perf · **File:** `app.css:356-361`

`transition: all` invalidates every property; for `.pool-card` it animates `border-color`, `background-color`, `box-shadow`, *and* `transform` together. On a long list of pool cards this measurably impacts iOS Safari. Be explicit: `transition: border-color .2s, transform .2s, box-shadow .2s`.

---

### M24 — Tests in two locations
**Category:** Testing / Architecture · **File:** `src/lib/server/*.test.ts`, `src/tests/routes/*.test.ts`

The note in commit `6425159` suggests a Vitest/SvelteKit-route compat hack drove the split. It's awkward: `scoring.test.ts` lives next to `scoring.ts` (idiomatic) while route tests live in `src/tests/routes/`. Document the rule in `README.md` or unify into `src/tests/`.

---

### M25 — `live-scores.ts` FIFA stage IDs are admitted stubs
**Category:** Reliability · **File:** `src/lib/server/live-scores.ts:228-236`

```ts
const FIFA_STAGE_MAP: Record<string, string> = {
  '285063': 'group',  // STUB
  …
};
```
The kickoff is 2026-06-11. This file is gated on `API_FOOTBALL_KEY` falling back to FIFA — and the FIFA path is known-broken. If `API_FOOTBALL_KEY` isn't set in prod, sync silently returns 0 matches. Add a startup log line that names the active provider, and gate the FIFA fallback behind an explicit env var so a misconfigured prod throws instead of degrading.

---

### M26 — `live-scores.ts` name-matching join is a polite SQL injection target
**Category:** Security / DB · **File:** `:160-173`

The query itself is parameterized correctly. But the `WITH resolver AS (SELECT id, lower(name) AS canon FROM teams UNION ALL SELECT team_id, alias_normalized FROM team_aliases)` references a `team_aliases` table that **does not exist** in any of the 8 migration files. If the live-score sync runs (admin clicks the button), this query throws.

**Fix:** Either add the migration (`team_aliases(id, team_id, alias_normalized, source)`) or remove the UNION branch until the table exists.

---

### M27 — `seed.ts` shares a FIFA rank between two teams
**Category:** Data / Code quality · **File:** `src/lib/server/seed.ts:21, 40`

Ivory Coast and Qatar are both `fifa_rank: 48`. The comment at the top admits this. The teams table doesn't constrain rank uniqueness so it's allowed, but: leaderboard tiebreaks could fall through to insertion order silently. The `teamsCached` query orders by `(group_name, fifa_rank)` (`cache.ts:50`) — ties resolve by row id, which is fine. Still: pin to a canonical source for each team, or split with `48a`/`48b`.

---

### M28 — `+page.server.ts` and `+layout.svelte` both hardcode `'2026-06-11T17:00:00Z'`
**Category:** Code quality / DRY · **File:** `src/routes/+layout.svelte:36, 121`, `src/routes/+page.server.ts:9`

Three independent literal occurrences of the kickoff timestamp. The 35-day "En juego" cutoff in `+layout.svelte:122` is computed from `1000*60*60*24*35`. Put `WORLD_CUP_KICKOFF`, `WORLD_CUP_DURATION_MS` in `$lib/constants.ts` and import.

---

## 4. LOW findings

### L1 — `_lastClean` in `hooks.server.ts:13` and `_lastEvict` in `rate-limit.ts:24` could collide on restart
**Category:** Code quality · One-line modules are hard to test. Pass `clock = () => Date.now()` into the limiter for tests.

### L2 — `migrate.ts` reads `__dirname` paths assuming a 3-level project layout
**Category:** DevEx · **File:** `:26`. If anyone moves this file, the migration runner silently looks at the wrong directory. Use `process.cwd()` + an env override.

### L3 — `getUserPools()` orders by `joined_at DESC, created_at DESC` then attaches `pool_size` via a correlated subquery
**Category:** DB · **File:** `queries.ts:136-145`. Use a LEFT JOIN with a window or `COUNT(*) OVER (PARTITION BY p.id)` for a cleaner plan once you have more than a handful of pools.

### L4 — `getPoolEntries()` joins to predictions LEFT and reads `pm.has_paid` as a fallback
**Category:** Code quality · **File:** `queries.ts:184`. The double-source of truth for "paid" (`pool_members.has_paid` and `predictions.has_paid`) feels accident-prone. Pick one.

### L5 — Random invite code generation can collide silently
**Category:** Code quality · **File:** `queries.ts:31-33`. 24 chars at ~38 alphabet ≈ 126 bits, so collisions are astronomically unlikely, but the `INSERT INTO pools` has no retry on `23505` for `invite_code`. Add a 1-retry loop; the chance is effectively zero, but the code path is reachable in principle.

### L6 — `createPrediction` no-op upsert
**Category:** Code quality · **File:** `queries.ts:204-208`. `ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label` is just idempotency. Use `DO NOTHING` and explicit `RETURNING id` semantics — clearer intent.

### L7 — `cache.ts` boot guard is module-side-effect
**Category:** Testability · **File:** `cache.ts:19-41`. The IIFE runs on import; unit-testing modules that import `cache.ts` becomes environment-sensitive. Move into an exported `assertSingleInstance()` called from `hooks.server.ts`.

### L8 — `+layout.server.ts` returns `user: locals.user || null`
**Category:** Code quality · **File:** `:5`. `locals.user` is already typed `User | undefined`. Use `?? null` and add an `app.d.ts` declaration so `data.user` is the same type everywhere — today the `?.` chains in `+layout.svelte` exist because the type isn't reliable.

### L9 — `PullToRefresh` binds `containerEl` to nothing
**Category:** Dead code · **File:** `:8, :38`. `bind:this={containerEl}` is set but the variable is unused.

### L10 — `app.css` skeleton fallback never fires
**Category:** Code quality · **File:** `:3-4`. `linear-gradient(90deg, var(--bg2) 25%, var(--bg3, #1a1d26) 50%, ...)` — `--bg3` is always defined, so the `#1a1d26` fallback is decorative.

### L11 — `app.css` `@import "tailwindcss"` is *after* the project styles
**Category:** Frontend · **File:** `:32`. Tailwind v4 utilities will override your project styles on selector ties. Move the `@import` to the top of the file.

### L12 — `data.pools.length` for the "Quinielas" stat card
**Category:** Code quality · **File:** `+page.svelte:109`. Cosmetic: shows "1 Quinielas" without pluralization, despite `pool.member_count !== 1 ? 's' : ''` being implemented above. Inconsistent.

### L13 — `data.user?.display_name?.charAt(0).toUpperCase()` falls through to `'?'`
**Category:** UX · **File:** `+layout.svelte:130`. The fallback is fine, but the same expression with `?.[0]` is used 30 lines later. Pick one shape.

### L14 — `setTimeout(stagger, 100)` to defeat SSR vs CSR timing
**Category:** Svelte 5 / Fragility · **File:** `+layout.svelte:95`. The 100ms is folklore.

### L15 — `header.js` store is JS but the rest of `$lib` is TS
**Category:** Code quality · **File:** `src/lib/stores/header.js`. Inconsistent for no apparent reason. Convert to `.ts` and type the store value.

### L16 — `data` is shadowed in `login/+page.svelte:26` (`const data = await res.json()`)
**Category:** Code quality · **File:** `:26`. The outer `let { data } = $props()` is unused after destructuring; the inner `data` shadows it. Just rename to `body` or `result`.

### L17 — `useSelfHosted = window.location.origin`-style copy in `pool/[id]/+page.svelte`
**Category:** Code quality · **File:** `:140-150`. Uses `navigator.clipboard` with `document.createElement('textarea')` fallback — fine, but `ta.style.left = '-9999px'` is the old technique. Modern fallback is `document.execCommand('copy')` after focus; or simply rely on the clipboard API and show an error otherwise.

### L18 — `+layout.svelte` and `pool/[id]/+page.svelte` both render the user's avatar initial; logic is duplicated
**Category:** Code quality · Extract `<Avatar user={...} />`.

### L19 — Many `console.error` without log structuring
**Category:** DevEx · There's a recurring `console.error('[area]', code, error)` pattern, but no central logger. With dozens of these spread across `+server.ts` files, a `logger.error({ area, code }, e)` from pino would let prod logging be filterable.

---

## 5. OPINION findings

### O1 — Audit-doc clutter
The repo root contains: `AUDIT-3-FRONTEND.md`, `AUDIT-4-GROUP-STAGE.md`, `AUDIT-FULL-OPUS.md`, `CODE-REVIEW.md`, `FIX-PLAN-3-FRONTEND.md`, `FIX-PLAN-4-GROUP-STAGE.md`, `FIX-PLAN-ALL.md`, `IMPLEMENTATION-PLAN.md`, `MIGRATION-PLAN.md`, `MIGRATIONS.md`, `WORLD-CUP-AUDIT-*.md` (×7), `WORLD-CUP-LOW-FIX-PLAN.md`, `WORLD-CUP-MEDIUM-FIX-PLAN.md`, `WORLD-CUP-SCORING-FIX-PLAN.md`, `world-cup-pool-audit-fix-plan.md`, plus this new file. Plus ~10 root-level test `.mjs` files (`test-both`, `test-cross-device`, `test-dnd`, `test-full`, `test-mobile`, `test-run`, `qa-cross-device`, `world-cup-test`, `full-test`).

This is review-document landfill. Move historical audits into `docs/audits/` and delete the stale `.mjs` files (or move into `scripts/`).

### O2 — Spanish in comments, English in code, both in user-facing strings
Code/comments alternate between languages: e.g. `scoring.ts:69-70` has a Spanish TODO, queries.ts has English numbered notes (`§3.12`), `+server.ts` user-facing errors are Spanish (`'No autorizado'`, `'Falta prediction_id'`). For a Spanish-speaking user base the strings are appropriate; for the codebase pick one language for comments to ease grep.

### O3 — Numbered section comments (`§3.7`, `B6-5`) reference external documents not in the repo
Comments like `// §3.4 — Defence-in-depth: …` and `// B6-5: Poner a cero todos los puntos…` are useful if the `§3.4` document exists, useless if it doesn't. None of the AUDIT-*.md files in root use this exact numbering. The references are decorative.

### O4 — `bracket/+page.svelte` at 1695 lines is the elephant in the room
That file holds R32→R16→QF→SF→Final routing maps, drag-drop state, label rendering, team-path highlighting, autosave, tiebreaker, entry switching, *and* its own helpers. Reading it requires holding too much in head. Even just extracting the static maps (`R32_MAP`, `R32_TO_R16`, `R32_LABELS`, `R16_LABELS`, `QF_LABELS`, `SF_LABELS`, `THIRD_GROUP_MAP`) into `$lib/bracket/maps.ts` would let you write a separate unit test for the routing logic — currently impossible because it's locked inside `<script>`.

### O5 — Hand-coded bracket maps fight the tournament format
The R32→R16→QF→SF connectivity is hand-numbered and the comments reference specific FIFA match numbers (M89, M90, …). This is data, not code. Source it from a JSON file with citations and you can detect a missing edge with `assert(R16.length === 8)` etc. Today a typo in `R32_TO_R16` mis-feeds bracket scoring.

### O6 — `scoring.ts:300-362` mixes the in-transaction client and the module-level `query()`
```ts
await client.query('COMMIT');
await query('UPDATE pools SET last_scored_at = NOW() …');
```
The transaction commits, then a follow-up `UPDATE` happens on a *different* connection. Functionally fine (this is just status bookkeeping), but conceptually you're treating bookkeeping as outside the transaction. Make it explicit with a `// outside txn:` comment, or keep it in the same client and commit after.

### O7 — Saving deletes-on-clear is a UX trap
`api/predictions/group/+server.ts:170-172` deletes the row when all positions are null. If a user manually clears a group to fix it, that wipes the row; the next read returns no row, and on next visit they see an empty group with no record they ever submitted it. Decide: do you keep history (audit_log? versioning?) or accept this is destructive? Today it's silently destructive.

### O8 — `pool.created_by` is the only way to identify pool admin
`pool/[id]/+page.server.ts:229` computes `isAdmin: pool.created_by === locals.user.id`. There's no `pool_admins` table, so multi-admin co-management is impossible. Probably fine for v1, but worth a comment.

### O9 — `buy_in NUMERIC(10,2)` with `currency TEXT DEFAULT 'EUR'`
No enum for currency, no constraint linking pools to a list of supported currencies. Either commit to multi-currency (then store both amount and currency consistently everywhere and add a symbol map) or drop the column.

### O10 — Several `setTimeout(() => saved = false, 2000)` reset patterns
Each page has its own flash-saved indicator with its own 2-second timer. Tedious to maintain consistency; a `useFlash()` rune-style helper would centralize.

### O11 — `header.js` writable store is one-line legacy
With Svelte 5, this should be a `getContext`/`setContext` pair or just `$state` in the layout. A standalone writable feels like leftover Svelte 4.

### O12 — The integrating tests reach into the DB; the unit tests mock
`db.integration.test.ts` is 814 lines. `live-scores.test.ts` is 503 lines (2× the source it tests). The fixtures probably re-implement the schema. Consider migrating the unit-style tests into the integration suite, since you already pay for a DB roundtrip in the integration test.

### O13 — `app.html` is presumably default SvelteKit (didn't inspect deeply)
But I'd expect a `<meta name="theme-color">` flip per theme (done in JS in `+layout.svelte:62`), and the SSR-safe theme bootstrap should live in `app.html`'s `<script>` to avoid the FOUC noted in M14.

### O14 — No `<title>` per page
Default `<title>` from SvelteKit (the `app.html` template) is shown on every page. Each route should set `<svelte:head><title>...</title></svelte:head>` for shareability, browser history, and a11y.

### O15 — `cleanSessions()` is called from `hooks.server.ts` and is fire-and-forget
A failed cleanup is logged once. With pgbouncer or a network blip, sessions accumulate. Move to a daily cron (or `pg_cron`) on the database; let the app stay stateless about session reaping.

### O16 — `getCachedSession` returns the user object the user sees in `event.locals`
But the cached object is `any`, and `setCachedSession` accepts `any`. Type the cache as `Pick<User, 'id' | 'username' | 'display_name' | 'is_admin'>` so the cache and the SQL response have to agree.

### O17 — `Math.ceil((kickoff - now) / 86_400_000)` for days-until
`+page.server.ts:11`. If kickoff is 25h away, this returns 2 days. Sometimes you want `floor`. Pick based on whether you want "1 day" to mean "≤24h" or "≥24h". The mobile UI shows "X days for the World Cup" — probably the user expects floor (i.e., "1 day" means "less than 48h").

### O18 — `flag()` ENG/SCT special-casing in 4 different files
Subdivisional flags aren't ISO-3166 country codes; the data model stores `flag_code` as TEXT to allow them. But the rendering code branches on the literal strings. If Wales qualify in a future cycle, it's another `if`. Map them to canonical code-points in the seed file once, store the actual emoji in DB.

### O19 — `npm test` story is unstated
`vitest.config.ts` and `vitest.integration.config.ts` co-exist (didn't inspect deeply). The README doesn't say "run `npm test` then `npm run test:integration`." A new contributor will guess wrong.

### O20 — `tsconfig.json` likely doesn't enforce `noUncheckedIndexedAccess`
Many `data.teams[id]?.name` chains exist. Turning on `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` would surface real bugs in the route components.

---

## 6. Summary table

| # | Severity | Category | Headline |
|---|---|---|---|
| C1 | CRITICAL | Frontend | Toast UI never renders despite being called |
| C2 | CRITICAL | Types | `Pool` interface field names don't match the schema |
| C3 | CRITICAL | DB | Shutdown handler can reopen pool mid-drain |
| H1 | HIGH | API | match-scores returns 200 OK on scoring failure |
| H2 | HIGH | Code quality | Bracket preceding-phase check depends on key iteration order |
| H3 | HIGH | Reliability | `setImmediate` rescoring lost on crash |
| H4 | HIGH | Security | Origin check ignores scheme |
| H5 | HIGH | Architecture | In-process rate limit not in boot guard |
| H6 | HIGH | Code quality | Default scoring rules defined twice |
| H7 | HIGH | Code quality | `seed.ts` exits process on import |
| H8 | HIGH | DRY | Three drifting copies of `flagEmoji`/`shortName` |
| H9 | HIGH | Frontend | Currency hardcoded `€` ignores per-pool field |
| H10 | HIGH | Security | Bracket save silently drops "started" phases |
| M1–M28 | MEDIUM | (various) | Schema constraints, indexes, theme polish, a11y, etc. |
| L1–L19 | LOW | (various) | Cleanup items |
| O1–O20 | OPINION | (various) | Aesthetic + structural takes |

## 7. If you fix nothing else, fix these in order

1. **C1** — render the toast. Low effort, high UX impact.
2. **C2** — regenerate or hand-correct `types.ts`. Half-truth types cost you twice.
3. **H1, H3** — close the silent-failure gap in scoring. The leaderboard *will* drift otherwise.
4. **H8 / O5 / O4** — extract shared helpers and the bracket maps into `$lib/`. Massive readability win for almost no risk.
5. **M5** — re-normalize `group_predictions`. You'll regret the 4-column shape the first time you need to "show all users who picked Brazil as group winner".
6. **M14** — fix the theme FOUC in `app.html`. One inline script.
7. **O1** — clean the audit-doc backlog. Future contributors will thank you.
