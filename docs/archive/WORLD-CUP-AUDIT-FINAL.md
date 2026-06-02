# World Cup Pool — Audit #6: Final Pre-Deployment Sweep

**Date:** 2026-05-27
**Auditor:** Claude Sonnet 4.6 (automated static analysis)
**Scope:** Data integrity · Race conditions · Input validation · Edge cases · Performance · Configuration · Secrets · Svelte 5 gotchas
**Previous audits fixed:** Auth/security (#1), E2E flows (#2), Frontend reactivity (#3), Live scoring (#4), Deployment readiness (#5)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 6     |
| MEDIUM   | 9     |
| LOW      | 12    |

No SQL injection, auth bypass, or plaintext secret storage found. The codebase is in good shape for a final sweep — all major security fundamentals are solid. The findings below are primarily atomicity gaps, missing validations, and performance anti-patterns.

---

## HIGH Severity

---

### H-01 — `match-scores` bulk INSERT runs outside a transaction

**File:** `src/routes/api/predictions/match-scores/+server.ts:79–98`
**Area:** Race Conditions / Data Integrity

The loop that saves per-match score predictions calls `query()` individually for each match, without a wrapping `BEGIN`/`COMMIT`. If the server crashes or a DB error occurs mid-loop, some scores are committed and others are not, leaving the prediction in a partially-written state. A concurrent save from the same user (e.g., rapid autosave bursts) can also interleave writes.

```typescript
// CURRENT — no transaction
for (const [matchIdStr, score] of Object.entries(scores)) {
	const matchId = Number(matchIdStr);
	// ...
	await query('DELETE FROM match_predictions WHERE ...');
	// or
	await query('INSERT INTO match_predictions ... ON CONFLICT DO UPDATE SET ...');
}
```

**Fix:** Wrap the entire loop in a `getClient()` transaction, same pattern as `bracket/+server.ts`.

```typescript
const client = await getClient();
try {
	await client.query('BEGIN');
	for (const [matchIdStr, score] of Object.entries(scores)) {
		// ... same logic using client.query(...)
	}
	await client.query('COMMIT');
} catch (e) {
	await client.query('ROLLBACK');
	throw e;
} finally {
	client.release();
}
```

---

### H-02 — `group-predictions` upsert loop runs outside a transaction

**File:** `src/routes/api/predictions/group/+server.ts:127–155`
**Area:** Race Conditions / Data Integrity

Same atomicity problem as H-01. Each group's predictions are upserted in a separate `query()` call with no transaction. If 12 groups are submitted and the DB fails on group 7, groups 1-6 are committed while groups 7-12 are not.

**Fix:** Same pattern — acquire client, `BEGIN`, loop over groups using `client.query()`, `COMMIT` or `ROLLBACK`.

---

### H-03 — Match prediction scores: no upper-bound or integer validation

**File:** `src/routes/api/predictions/match-scores/+server.ts:82–97`
**Area:** Input Validation

The tiebreaker endpoint caps values at 0–30 and checks `Number.isInteger`. The admin results endpoint caps at 0–30 and checks `Number.isInteger`. The match-scores prediction endpoint only checks `< 0`:

```typescript
// CURRENT — only lower bound
if (homeScore === null || awayScore === null || isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
```

Consequences:
1. A user can predict scores like `999:999` — valid to the API, stored in DB.
2. A float like `2.5` passes the JS check but causes a PostgreSQL type cast error, returning a confusing 500 instead of a 400.

**Fix:**
```typescript
if (
	homeScore === null || awayScore === null ||
	!Number.isInteger(homeScore) || !Number.isInteger(awayScore) ||
	homeScore < 0 || awayScore < 0 ||
	homeScore > 30 || awayScore > 30
) {
	// delete the prediction row
}
```

---

### H-04 — N+1 queries in `summary/+page.server.ts`

**File:** `src/routes/pool/[id]/summary/+page.server.ts:23–37`
**Area:** Performance

The summary page loops over the user's prediction entries and fires two separate DB queries per entry:

```typescript
// CURRENT — N+1 (2 queries × N entries)
for (const entry of entries) {
	const { rows: gpRows } = await query(
		`SELECT ... FROM group_predictions WHERE prediction_id = $1 ORDER BY group_name`,
		[entry.id]
	);
	groupPreds[entry.id] = gpRows;

	const { rows: bpRows } = await query(
		`SELECT ... FROM bracket_predictions WHERE prediction_id = $1 ORDER BY phase, slot`,
		[entry.id]
	);
	bracketPreds[entry.id] = bpRows;
}
```

With 10 entries this is 20 queries. The pool overview page (`pool/[id]/+page.server.ts:25–49`) already has the correct fix for this same pattern using `ANY($1::int[])`. The summary page was not updated.

**Fix:**
```typescript
const entryIds = entries.map(e => e.id);
if (entryIds.length > 0) {
	const { rows: allGP } = await query(
		`SELECT prediction_id, group_name, position_1, position_2, position_3, position_4
		FROM group_predictions WHERE prediction_id = ANY($1::int[]) ORDER BY group_name`,
		[entryIds]
	);
	for (const gp of allGP) {
		if (!groupPreds[gp.prediction_id]) groupPreds[gp.prediction_id] = [];
		groupPreds[gp.prediction_id].push(gp);
	}
	// same pattern for bracket_predictions
}
```

---

### H-05 — No SSL/TLS configuration in `pg.Pool`

**File:** `src/lib/server/db.ts:9`
**Area:** Configuration

```typescript
// CURRENT — no SSL config
_pool = new pg.Pool({ connectionString: url, max: 10 });
```

For a remote PostgreSQL host (Neon, Supabase, Railway, etc.), SSL is required. If `DATABASE_URL` is missing `?sslmode=require`, the `pg` driver connects unencrypted. Neon and Supabase default to requiring SSL, so this typically works, but it is silent about the security mode being used and will fail without explanation on any host that requires explicit SSL.

Also missing: `idleTimeoutMillis` and `connectionTimeoutMillis`. Without these, a stalled DB connection hangs the Node process indefinitely.

**Fix:**
```typescript
_pool = new pg.Pool({
	connectionString: url,
	max: 10,
	idleTimeoutMillis: 30_000,
	connectionTimeoutMillis: 5_000,
	ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: true },
});
```

Add `DB_SSL=false` to `.env` for local dev if the local Postgres doesn't use SSL.

---

### H-06 — Prediction entry `label` has no length validation

**File:** `src/routes/api/predictions/entry/+server.ts:9`
**Area:** Input Validation

```typescript
// CURRENT — no length check on label
const { pool_id, label = '' } = body;
```

The `label` is stored in a `TEXT` column with no DB-level length constraint. A user can send a label that is thousands of characters long (or a Unicode bomb). The pool-level leaderboard and admin member list embed the label in responses.

**Fix:** Add a length and trim check:
```typescript
const rawLabel = (body.label ?? '').trim();
if (rawLabel.length > 50) {
	return json({ error: 'La etiqueta no puede superar 50 caracteres' }, { status: 400 });
}
const label = rawLabel;
```

---

## MEDIUM Severity

---

### M-01 — Correlated subquery in `getPoolLeaderboard` fires per row

**File:** `src/lib/server/queries.ts:189–199`
**Area:** Performance

```sql
SELECT p.*, u.display_name, u.username,
  (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.pool_id) as pool_size   -- ← correlated
FROM predictions p
JOIN users u ON u.id = p.user_id
WHERE p.pool_id = $1
ORDER BY p.total_score DESC, p.updated_at ASC
```

`pool_size` is the same value for every row (it's a pool-level stat), but the subquery executes once per prediction. For a pool with 100 entries this is 100 extra queries.

**Fix:** Move to a scalar subquery in the SELECT that doesn't repeat, or prefetch once:
```sql
SELECT p.*, u.display_name, u.username,
  (SELECT COUNT(*) FROM pool_members WHERE pool_id = $1) as pool_size
FROM predictions p
JOIN users u ON u.id = p.user_id
WHERE p.pool_id = $1
ORDER BY p.total_score DESC, p.updated_at ASC
```

Or even simpler, since the caller already has the pool context, remove `pool_size` from the leaderboard query and pass it separately.

---

### M-02 — Unbounded user list in global admin page

**File:** `src/routes/admin/+page.server.ts:25–30`
**Area:** Performance

```typescript
const { rows: allUsers } = await query(
	`SELECT id, display_name, username FROM users WHERE is_admin = false ORDER BY display_name`
);
```

No `LIMIT` clause. Returns all non-admin users. At small scale (< 500 users) this is fine, but with user growth it becomes a large serialized payload on every admin page load.

**Fix:** Add server-side search or a `LIMIT 500`. The admin page already has a `searchQuery` filter on the client; moving it server-side would solve both issues.

---

### M-03 — `od_user_id` column alias typo in `getPoolMembers`

**File:** `src/lib/server/queries.ts:154`
**Area:** Data Integrity / Code Quality

```sql
SELECT u.id as od_user_id,   -- ← should be 'user_id'
```

The column is named `od_user_id` (appears to be a remnant of an older alias). The admin page template compensates by accessing `member.od_user_id` directly (seen at `pool/[id]/admin/+page.svelte:142,150,377`), so it works — but any future code written assuming `member.user_id` will silently receive `undefined`. Extremely confusing for new contributors.

**Fix:** Rename the alias to `user_id` and update the three references in `admin/+page.svelte`.

---

### M-04 — Invalid `match_id` returns 500 instead of 400

**File:** `src/routes/api/predictions/match-scores/+server.ts:88–97`
**Area:** Input Validation / Edge Cases

The endpoint validates that submitted match IDs have not started (kickoff deadline check), but does not verify the match IDs actually exist in the `matches` table. If a user sends a fabricated `matchId` that doesn't exist:
- The kickoff check passes (no rows returned for that ID → passes)
- The `INSERT INTO match_predictions ... REFERENCES matches(id)` fails with a FK violation
- The `catch` at line 115 returns a generic 500

**Fix:** After the kickoff check, verify all submitted IDs are known:
```typescript
const { rows: validMatches } = await query(
	'SELECT id FROM matches WHERE id = ANY($1::int[])',
	[matchIds]
);
if (validMatches.length !== matchIds.length) {
	return json({ error: 'Algunos partidos no existen' }, { status: 400 });
}
```

---

### M-05 — `pool.emoji` field used in templates but missing from DB schema

**Files:**
- `src/routes/pool/[id]/+page.svelte:23` — `pool.emoji || '🏆'`
- `src/routes/pool/[id]/bracket/+page.svelte:8` — `data.pool?.emoji || '⚔️'`
**Area:** Edge Cases / Data Integrity

The `pools` table has no `emoji` column in any migration file. `getPoolById` uses `SELECT *`, so `pool.emoji` is `undefined` (not null — because the column doesn't exist, the key is absent from the row). The `|| '🏆'` fallback silently masks this. The field appears to have been planned but never migrated.

Two options:
1. **Add a migration** to add `emoji TEXT DEFAULT '🏆'` to pools and expose it in the create pool form.
2. **Remove the references** and hardcode the fallback emoji, acknowledging the feature was dropped.

The current state silently drops the feature — users see the default emoji always, with no way to customise it.

---

### M-06 — `fetchFromFifaApi` maps `undefined` match ID to string `"undefined"`

**File:** `src/lib/server/live-scores.ts:100`
**Area:** Edge Cases / External API

```typescript
fifa_id: String(m.idMatch),   // ← if m.idMatch is undefined, stores "undefined"
```

If the FIFA API returns a match object with a missing or renamed `idMatch` field (plausible given API instability), `String(undefined)` = `"undefined"`. This value gets passed to the DB lookup:

```typescript
const res = await query('SELECT * FROM matches WHERE fifa_id = $1', [m.fifa_id]);
```

A match with `fifa_id = 'undefined'` could match an incorrect row (unlikely, but possible if a row was previously inserted with a bad sync). The fuzzy team-name fallback then runs unnecessarily.

**Fix:**
```typescript
fifa_id: m.idMatch != null ? String(m.idMatch) : null,
```
And update `syncScores` to skip entries where `fifa_id` is null.

---

### M-07 — `_lastClean` session cleanup counter not atomic under concurrency

**File:** `src/hooks.server.ts:33–34`
**Area:** Race Conditions

```typescript
if (now - _lastClean > 60_000) { _lastClean = now; cleanSessions().catch(console.error); }
```

Node.js is single-threaded so this is not a true race condition. However, since `cleanSessions()` is async and not awaited, `_lastClean` is updated synchronously before `cleanSessions` completes. If `cleanSessions` throws after `_lastClean` is set, the error is silently swallowed and the next 60-second window starts. This is LOW impact since `cleanSessions` is idempotent, but the pattern should be documented.

More impactfully: if the server runs under Node.js cluster mode or behind a worker-thread adapter, `_lastClean` is per-process and does NOT prevent simultaneous cleanup across workers.

**Fix (low-risk):** No code change needed for single-process deployment. Add a comment documenting the cluster caveat.

---

### M-08 — Rate limiting only on `/api/auth` — prediction endpoints unprotected

**Files:** `src/routes/api/predictions/*.ts`, `src/routes/api/pools/join/+server.ts`
**Area:** Security

Login and register are rate-limited (10 req / 15 min per IP). Prediction save endpoints have no rate limiting — a script could spam saves 1000×/second, generating background `calculateAllScores()` tasks via `setImmediate` and overwhelming the DB.

**Fix (pragmatic):** Add a simple in-memory rate limiter on the heavy endpoints (`match-scores`, `group`, `bracket`), or offload scoring to a proper background queue. At minimum, skip `calculateAllScores` if it was called within the last N seconds for the same pool.

---

### M-09 — `pools.created_by` FK has no ON DELETE — user deletion will silently fail

**File:** `drizzle/migrations/0001_initial.sql:22`
**Area:** Data Integrity

```sql
created_by INTEGER NOT NULL REFERENCES users(id)   -- no ON DELETE
```

PostgreSQL default is `RESTRICT`. If an admin ever tries to delete a user who created pools, the deletion will fail with a FK violation. There is no admin UI for deleting users, so this is currently unexploitable. But without explicit `ON DELETE RESTRICT` in the DDL, the intent is undocumented and could be accidentally overridden in a future migration.

Similarly, `audit_log.user_id INTEGER REFERENCES users(id)` (no ON DELETE) means users with audit log entries also cannot be deleted.

**Fix:** Add explicit `ON DELETE RESTRICT` to document intent, and ensure any future user-deletion admin feature handles this gracefully.

---

## LOW Severity

---

### L-01 — `SELECT *` in multiple query functions

**Files:**
- `src/lib/server/queries.ts:114` — `SELECT * FROM pools WHERE invite_code = $1`
- `src/lib/server/queries.ts:119` — `SELECT * FROM pools WHERE id = $1`
- `src/lib/server/queries.ts:184` — `SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2`
- `src/routes/api/predictions/entry/+server.ts:14` — `SELECT * FROM pools WHERE id = $1`
- `src/routes/api/admin/results/+server.ts:38` — `SELECT * FROM matches WHERE id = $1`
**Area:** Performance

`SELECT *` fetches all columns including large TEXT fields and TIMESTAMPTZ values that may not be used. Fine at current scale; becomes a concern if columns with large payloads (e.g., a future `description` TEXT) are added. Explicit column lists also serve as self-documenting contracts.

---

### L-02 — `getAllTeamsCached` uses `SELECT *` and caches forever

**File:** `src/lib/server/cache.ts:22`
**Area:** Performance / Edge Cases

```typescript
const result = await query('SELECT * FROM teams ORDER BY group_name, fifa_rank');
_teams = result.rows as any[];
```

Teams are loaded once and never invalidated (correctly — they're static). However if `invalidateTeamsCache()` is ever called (it exists) without the server restarting, `_teams` becomes null and the next request re-fetches. There is no concurrent protection against multiple simultaneous requests all finding `_teams = null` and all firing the SELECT. A Promise-based singleton pattern would prevent duplicate concurrent fetches.

---

### L-03 — `getUserPools` correlated subquery runs per pool

**File:** `src/lib/server/queries.ts:126`
**Area:** Performance

```sql
(SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
```

Runs once per pool the user belongs to. Same pattern as M-01. Replace with a `LEFT JOIN (SELECT pool_id, COUNT(*) FROM pool_members GROUP BY pool_id) mc ON mc.pool_id = p.id`.

---

### L-04 — `autoSaveTimer` / `matchSaveTimer` declared as untyped `null`

**File:** `src/routes/pool/[id]/predict/+page.svelte:179,265`
**Area:** Svelte 5 Gotchas

```javascript
let autoSaveTimer = null;   // implicit any
let matchSaveTimer = null;  // implicit any
```

TypeScript cannot catch misuse. The cleanup `$effect` at line 256 correctly handles both timers, but the declaration should be explicit to prevent future errors when passing to `clearTimeout`.

**Fix:**
```typescript
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let matchSaveTimer: ReturnType<typeof setTimeout> | null = null;
```

---

### L-05 — Dead `loadTiebreaker()` function in bracket page

**File:** `src/routes/pool/[id]/bracket/+page.svelte:330–339`
**Area:** Svelte 5 Gotchas / Code Quality

`loadTiebreaker()` is defined as a standalone async function but is never called directly — the `$effect` at line 366 duplicates its logic inline. The standalone function is dead code that adds confusion.

**Fix:** Remove `loadTiebreaker()` and keep only the `$effect`.

---

### L-06 — `isDark` $state reads DOM once — does not react to OS theme changes

**File:** `src/routes/+layout.svelte:29–33`
**Area:** Svelte 5 Gotchas

```javascript
let isDark = $state(true);
$effect(() => {
	if (!browser) return;
	isDark = document.documentElement.getAttribute('data-theme') !== 'light';
});
```

This reads the DOM attribute once on mount. If the user's OS switches theme (or another tab changes it), `isDark` won't update until the page reloads.

**Fix:** Add a `MutationObserver` on `document.documentElement` watching the `data-theme` attribute, or use `window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ...)`.

---

### L-07 — `$effect` assignments to `$state` from `$derived` cause full reset on data reload

**File:** `src/routes/pool/[id]/predict/+page.svelte:54–55`
**Area:** Svelte 5 Gotchas

```javascript
const selectionsInit = $derived.by(() => { /* reads data.existingGroupPreds */ });
let selections = $state({});
$effect(() => { selections = JSON.parse(JSON.stringify(selectionsInit)); });
```

When the server refetches data (e.g., after an invalidation triggered by `goto(..., { invalidateAll: true })`), `selectionsInit` recomputes and the effect fires, wiping any in-flight user edits to `selections`. This is intentional for entry-switching, but if the autosave debounce is mid-flight when this fires, the save fires with the new (reset) data rather than the user's just-entered data.

The current 600 ms debounce means there is a narrow race window. No change is urgent, but the behaviour should be documented.

---

### L-08 — FIFA competition ID `254648` is a placeholder that must be verified

**File:** `src/lib/server/live-scores.ts:78–80`
**Area:** Configuration / Edge Cases

```typescript
// TODO: update '254648' once FIFA publishes 2026 WC official API endpoints
const res = await fetch(
	`${FIFA_BASE}/matches/competitions/254648?status=completed`,
```

The FIFA API competition ID for World Cup 2026 is unconfirmed. If wrong, every `fetchFromFifaApi` call returns 404 and no scores are synced (it falls back gracefully, returning `[]`). The fallback to API-Football is good, but if `API_FOOTBALL_KEY` is also absent, all score syncing silently does nothing.

**Action required before tournament:** Verify the FIFA competition ID, and add a startup warning log if neither `API_FOOTBALL_KEY` is set nor the FIFA ID is confirmed.

---

### L-09 — `penalty_winner_id` FK in migration has no ON DELETE clause

**File:** `src/lib/server/migrations/0006_penalty_winner.sql:4`
**Area:** Data Integrity

```sql
ALTER TABLE matches ADD COLUMN penalty_winner_id INTEGER REFERENCES teams(id);
```

No ON DELETE. Defaults to RESTRICT. Teams are effectively static during the tournament, so this is fine — but like L-01/M-09, the intent should be explicit: `REFERENCES teams(id) ON DELETE RESTRICT`.

---

### L-10 — `vite.config.ts` `allowedHosts: true` is dev-only but undocumented

**File:** `vite.config.ts:10`
**Area:** Configuration

`allowedHosts: true` allows any hostname to reach the Vite dev server. This is harmless in production (the Vite dev server is not used in production builds). Worth adding a comment:

```typescript
server: {
	port: 3470,
	host: true,
	allowedHosts: true  // dev only — production uses adapter-node
},
```

---

### L-11 — No index on `sessions.token` column

**File:** `drizzle/migrations/0001_initial.sql`
**Area:** Performance

The `sessions` table has `token TEXT NOT NULL UNIQUE`. PostgreSQL automatically creates a unique index for UNIQUE constraints, so `WHERE token = $1` is already indexed. ✅ (No action needed — this was a concern that was already handled.)

---

### L-12 — `getPoolMembers` query returns one row per prediction entry, not per member

**File:** `src/lib/server/queries.ts:151–166`
**Area:** Edge Cases

```sql
LEFT JOIN predictions pr ON pr.pool_id = pm.pool_id AND pr.user_id = pm.user_id
```

A user with `allow_multiple_predictions` having 3 entries will appear 3 times in the result. The admin page renders all rows (one per entry), which is the intended behaviour for per-entry payment tracking. However, `stats.totalMembers` in the admin page is computed as `members.length` (after `getPoolMembers`), which would incorrectly over-count multi-entry users.

**File:** `src/routes/pool/[id]/admin/+page.server.ts:37`
```typescript
totalMembers: members.length,   // ← counts entries, not distinct members
```

**Fix:** Use `(SELECT COUNT(DISTINCT user_id) FROM pool_members WHERE pool_id = $1)` for `totalMembers` instead of `members.length`.

---

## Configuration Checklist

Ensure these environment variables are set in production:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ Yes | Include `?sslmode=require` for Neon/Supabase |
| `NODE_ENV` | ✅ Yes | Must be `production` to enable secure cookies |
| `API_FOOTBALL_KEY` | ⚠️ Recommended | Without it, live score sync silently no-ops |
| `DB_SSL` | Optional | Set to `false` only for local dev without SSL |

---

## Findings Not Present (Confirmed Clean)

- **SQL injection:** All user inputs use parameterised queries (`$1`). The one dynamic SQL construction in `leaderboard/+page.server.ts` (`orderByTiebreaker`) interpolates only `Math.trunc(Number(...))` values from trusted DB data — safe.
- **Dynamic `ORDER BY` injection:** All `ORDER BY` clauses use hardcoded column names. The `scoring/+server.ts` dynamic `UPDATE pools SET ...` builds column name strings from an internal-only whitelist.
- **Hardcoded secrets:** No API keys or passwords are hardcoded. `API_FOOTBALL_KEY` is read exclusively from `process.env`.
- **Auth bypass:** Session validation requires both a valid token and non-expired `expires_at`. The hooks middleware correctly enforces this on all non-public paths.
- **TOCTOU in pool join:** Fixed in Audit #2 — `FOR UPDATE` lock prevents duplicate joins.
- **TOCTOU in entry creation:** Fixed — `FOR UPDATE` + label uniqueness check under lock.
- **Cascade deletes:** Verified correct. All child tables (`pool_members`, `predictions`, `match_predictions`, `group_predictions`, `bracket_predictions`, `scoring_config`, `sessions`, `tiebreaker`, `pool_creators`) use `ON DELETE CASCADE` from their parent FKs.
- **Svelte 5 reactivity (effects/derived):** Countdown timer cleanup (`clearInterval` in return), entry-switch state reset, and bracket version bumping are all correctly implemented.
- **`$state` inside `$effect` loops:** Not found. No infinite reactivity loops detected.

---

## Priority Fix Order

1. **H-01** and **H-02** — Wrap match-score and group-prediction saves in transactions (prevents data corruption on concurrent saves or failures)
2. **H-03** — Add upper-bound and integer validation to match-score predictions (consistency with other endpoints)
3. **H-04** — Fix N+1 in summary page (direct port of already-existing pattern from pool/[id]/+page.server.ts)
4. **H-05** — Add SSL + timeout config to `pg.Pool` (critical for remote Postgres hosts)
5. **H-06** — Add label length validation (prevents oversized inputs)
6. **L-12** — Fix `totalMembers` stat to count distinct users, not entries
7. **M-01** — Replace correlated `pool_size` subquery with scalar or join
8. **M-05** — Decide: add `emoji` column migration or remove dead references
9. All remaining MEDIUM/LOW items are operational improvements and can be addressed post-launch
