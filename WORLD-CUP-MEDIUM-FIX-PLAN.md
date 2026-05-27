# World Cup Pool — Medium Findings: Implementation-Ready Fix Plan

**Date:** 2026-05-27
**Based on:** Audit reports #1–#6 (WORLD-CUP-AUDIT-*.md)
**Author:** Claude Sonnet 4.6

---

## Legend

	✅ ALREADY FIXED — verified in current code; include for tracking only
	🔧 FIX REQUIRED — full implementation plan below
	🔗 DEPENDENCY — other fix must apply first

---

## Quick-Reference Table

| ID | Severity | Status | File(s) | Description |
|----|----------|--------|---------|-------------|
| WCP-08 | MEDIUM | 🔧 | `leaderboard/+page.server.ts` | Tiebreaker SQL interpolates DB values that could be NaN |
| WCP-09 | MEDIUM | 🔧 | `queries.ts`, `admin/+page.svelte` | `od_user_id` alias typo in getPoolMembers |
| WCP-11 | MEDIUM | 🔧 | New file + 4 prediction handlers | No rate limiting on prediction submission |
| WCP-12/B6-3 | MEDIUM | 🔧 | `scoring.ts` | Concurrent calculateAllScores races — no advisory lock |
| WCP-13 | MEDIUM | ✅ | `api/pools/+server.ts:34` | Pool name max-length — already fixed |
| B2-1 | MEDIUM | ✅ | `api/pools/+server.ts:34` | Same as WCP-13 — already fixed |
| B2-2 | MEDIUM | ✅ | `api/pools/+server.ts:35-36` | buy_in type guard — already fixed |
| B3-1 | MEDIUM | 🔧 | `api/pools/join/+server.ts` | No member limit enforcement |
| B3-2 | MEDIUM | 🔧 | `s/[code]/+page.server.ts` + migration | Public leaderboard URL exposes invite code |
| B4-4 | MEDIUM | 🔧 | `api/predictions/group/+server.ts` | Kickoff check blocks all groups if any started |
| B5-2 | MEDIUM | 🔧 | `api/predictions/bracket/+server.ts` | Bracket deadline check blocks all phases |
| B5-3 | MEDIUM | 🔧 | `api/predictions/bracket/+server.ts` | No server-side bracket consistency validation |
| B6-2 | MEDIUM | 🔧 | `admin/+page.server.ts`, `admin/+page.svelte` | Scoring failures invisible to admin |
| B7-1 | MEDIUM | ✅ | `api/admin/payment/+server.ts:17` | Silent no-op payment — already fixed |
| B7-2 | MEDIUM | ✅ | `queries.ts:171-175` | has_paid inheritance — already fixed |
| 8a | MEDIUM | 🔧 | `predict/+page.svelte` | Deadline passes mid-session; inputs stay enabled |
| 8d | MEDIUM | 🔧 | `pool/[id]/+page.server.ts` | No deterministic final tiebreaker |
| 8e | MEDIUM | 🔧 | `s/[code]/+page.server.ts` | Leaderboard sort differs between pool page and /s/ URL |

---

## Dependency Order

Apply fixes in this sequence to avoid broken intermediate states:

	1. Migration: B3-2 share_token column (run before code changes touch /s/ route)
	2. WCP-09 (od_user_id) — queries.ts + admin/+page.svelte in one commit
	3. WCP-08 (tiebreaker NaN guard) — standalone
	4. WCP-11 (rate limiting) — create new file first, then update endpoints
	5. WCP-12/B6-3 (advisory lock) — standalone, scoring.ts only
	6. B3-1 (member limit) — standalone
	7. B3-2 (share token URL) — after migration from step 1
	8. B4-4 (group kickoff filter) — standalone
	9. B5-2 (bracket phase filter) — standalone
	10. B5-3 (bracket consistency) — after B5-2 is understood
	11. B6-2 (scoring error display) — standalone
	12. 8a (deadline mid-session lock) — standalone
	13. 8d (deterministic tiebreaker) — standalone, pool leaderboard sort
	14. 8e (leaderboard consistency) — after 8d, so same sort logic is clear

---

## Already-Fixed Items (Verification)

### WCP-13 / B2-1 — Pool Name Max Length ✅

**Verification:** `src/routes/api/pools/+server.ts:33-34`
```typescript
if (!name?.trim() || name.trim().length < 2) return json({ error: 'Nombre requerido (mínimo 2 caracteres)' }, { status: 400 });
if (name.trim().length > 100) return json({ error: 'Nombre demasiado largo (máximo 100 caracteres)' }, { status: 400 });
```
No action needed.

### B2-2 — buy_in Type Guard ✅

**Verification:** `src/routes/api/pools/+server.ts:35-36`
```typescript
const buyin = Number(buy_in);
if (!isFinite(buyin) || buyin < 0) return json({ error: 'buy_in debe ser un número positivo' }, { status: 400 });
```
No action needed.

### B7-1 — Silent No-Op Payment ✅

**Verification:** `src/routes/api/admin/payment/+server.ts:17`
```typescript
if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });
```
No action needed.

### B7-2 — has_paid Inheritance ✅

**Verification:** `src/lib/server/queries.ts:170-175`
```typescript
export async function createPrediction(poolId: number, userId: number, label = '') {
  const { rows: memberRows } = await query(
    'SELECT has_paid FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, userId]
  );
  const hasPaid = memberRows[0]?.has_paid ?? false;
```
No action needed.

---

## Fix 1 — WCP-08: Tiebreaker SQL NaN Guard

**Finding ID:** WCP-08
**Audit:** Audit #1 (WORLD-CUP-AUDIT-REPORT.md)
**Severity:** MEDIUM — Security / Defence-in-depth
**File:** `src/routes/leaderboard/+page.server.ts`
**Lines:** 21–28

### Problem

`Math.trunc(Number(undefined))` evaluates to `NaN`. If `finalMatch.home_score` or `finalMatch.away_score` is `undefined` (e.g., due to an unexpected DB schema change or NULL handling), the interpolated SQL becomes `ABS(tb.home_score - NaN)` — invalid PostgreSQL syntax causing a 500. Even though the admin API validates scores on write, interpolating DB-sourced values into SQL violates defence-in-depth.

### Old Code (lines 21–28)

```typescript
	let orderByTiebreaker = '0'; // no-op if no final yet
	if (finalMatch) {
	  // Smaller closeness = better: sum of absolute differences
	  const h = Math.trunc(Number(finalMatch.home_score));
	  const a = Math.trunc(Number(finalMatch.away_score));
	  orderByTiebreaker = `(
	    COALESCE(ABS(tb.home_score - ${h}) + ABS(tb.away_score - ${a}), 9999)
	  )`;
	}
```

### New Code (lines 21–28)

```typescript
	let orderByTiebreaker = '0'; // no-op if no final yet
	if (finalMatch) {
	  // Guard: only interpolate if both scores are valid integers.
	  // Math.trunc(Number(undefined)) = NaN, which produces invalid SQL.
	  const hRaw = Math.trunc(Number(finalMatch.home_score));
	  const aRaw = Math.trunc(Number(finalMatch.away_score));
	  if (Number.isInteger(hRaw) && Number.isInteger(aRaw)) {
	    // Safe to interpolate: both values are confirmed integers from our own DB.
	    orderByTiebreaker = `(
	      COALESCE(ABS(tb.home_score - ${hRaw}) + ABS(tb.away_score - ${aRaw}), 9999)
	    )`;
	  }
	  // If scores are not valid integers (e.g. NULL coerced to NaN),
	  // keep orderByTiebreaker = '0' — leaderboard works without tiebreaker.
	}
```

### SQL Migrations Needed

None.

### Dependency

None — standalone change.

---

## Fix 2 — WCP-09: `od_user_id` Alias Typo in `getPoolMembers`

**Finding ID:** WCP-09 (also B7-4 in Audit #2)
**Audit:** Audit #1, Audit #2
**Severity:** MEDIUM — Correctness
**Files:**
	- `src/lib/server/queries.ts` — line 154 (the typo)
	- `src/routes/pool/[id]/admin/+page.svelte` — lines 150, 377 (consumer references)

### Problem

The column alias `od_user_id` (transposition of 'o' and 'd') instead of `user_id` means any new code accessing `member.user_id` gets `undefined`. The admin page was written to match the typo, so it currently works, but it is a maintenance hazard and breaks any future code expecting the standard field name.

### Change A — `src/lib/server/queries.ts:154`

**Old code (line 153–154):**
```typescript
	const { rows } = await query(
	  `SELECT u.id as od_user_id, u.username, u.display_name,
```

**New code (line 153–154):**
```typescript
	const { rows } = await query(
	  `SELECT u.id as user_id, u.username, u.display_name,
```

### Change B — `src/routes/pool/[id]/admin/+page.svelte:150`

**Old code (line 150):**
```javascript
	        _members = _members.map(m => m.od_user_id === odUserId ? { ...m, has_paid: newValue ? 1 : 0 } : m);
```

**New code (line 150):**
```javascript
	        _members = _members.map(m => m.user_id === odUserId ? { ...m, has_paid: newValue ? 1 : 0 } : m);
```

### Change C — `src/routes/pool/[id]/admin/+page.svelte:377`

**Old code (line 377):**
```svelte
	            onclick={() => togglePaid(member.entry_id, member.has_paid, member.display_name, member.od_user_id)}
```

**New code (line 377):**
```svelte
	            onclick={() => togglePaid(member.entry_id, member.has_paid, member.display_name, member.user_id)}
```

### SQL Migrations Needed

None — alias change only.

### Dependency

None — but apply all three changes in the same commit to avoid breaking the admin payment toggle.

---

## Fix 3 — WCP-11: Rate Limiting on Prediction Endpoints

**Finding ID:** WCP-11
**Audit:** Audit #1 (WORLD-CUP-AUDIT-REPORT.md)
**Severity:** MEDIUM — Security
**Files:**
	- `src/lib/server/rate-limit.ts` (NEW FILE)
	- `src/routes/api/predictions/group/+server.ts` (add check at top of POST)
	- `src/routes/api/predictions/bracket/+server.ts` (add check at top of POST)
	- `src/routes/api/predictions/match-scores/+server.ts` (add check at top of POST)
	- `src/routes/api/predictions/tiebreaker/+server.ts` (add check at top of POST)

### Problem

Each POST to `match-scores` triggers `setImmediate(calculateAllScores)`, which holds a DB connection for a full transaction. An automated script submitting 100 saves/second queues hundreds of scoring jobs, exhausting the 10-connection pool and starving other requests. Auth endpoints have a 10-req/15-min limit; prediction endpoints have no limit at all.

### New File — `src/lib/server/rate-limit.ts` (create new)

```typescript
/**
 * In-process rate limiter for prediction save endpoints.
 * Limits each authenticated user to PRED_LIMIT saves per PRED_WINDOW ms.
 *
 * Note: Process-local (not shared across instances). Acceptable trade-off for
 * this use case — the primary goal is preventing accidental runaway autosave
 * bursts from a single browser session, not adversarial multi-instance abuse.
 */

const _predLimits = new Map<number, { count: number; resetAt: number }>();

const PRED_LIMIT = 30;          // max saves per window
const PRED_WINDOW = 60_000;     // 1-minute rolling window

// Evict expired entries to prevent unbounded growth
function _evictExpired(): void {
	const now = Date.now();
	for (const [userId, entry] of _predLimits) {
	  if (now > entry.resetAt) _predLimits.delete(userId);
	}
}

// Evict every 5 minutes (runs on first call after 5 min elapsed)
let _lastEvict = 0;

/**
 * Returns true if the user is within rate limit; false if they should receive 429.
 * Increments the counter on every call.
 */
export function checkPredictionRate(userId: number): boolean {
	const now = Date.now();

	// Periodic eviction — O(n) but infrequent
	if (now - _lastEvict > 300_000) {
	  _evictExpired();
	  _lastEvict = now;
	}

	const entry = _predLimits.get(userId);
	if (!entry || now > entry.resetAt) {
	  _predLimits.set(userId, { count: 1, resetAt: now + PRED_WINDOW });
	  return true;
	}
	if (entry.count >= PRED_LIMIT) return false;
	entry.count++;
	return true;
}
```

### Change A — `src/routes/api/predictions/group/+server.ts`

Add at line 1 (top of file, after existing imports):
```typescript
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

Add as the **first check inside the POST handler**, after the auth guard (after line 46 `if (!locals.user) return ...`):
```typescript
	// Rate limit: 30 saves / minute per user
	if (!checkPredictionRate(locals.user.id)) {
	  return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
	}
```

**Exact insertion point:** After line 46 `if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });` and before line 48 `const body = await request.json();`.

### Change B — `src/routes/api/predictions/bracket/+server.ts`

Same pattern. Add import at top of file:
```typescript
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

Add rate check after auth guard (after line 45 `if (!locals.user) return ...`):
```typescript
	if (!checkPredictionRate(locals.user.id)) {
	  return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
	}
```

**Exact insertion point:** After line 45, before line 47 `const body = await request.json();`.

### Change C — `src/routes/api/predictions/match-scores/+server.ts`

Same pattern. Add import at top of file:
```typescript
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

Add rate check after auth guard (after line 10 `if (!locals.user) return ...`):
```typescript
	if (!checkPredictionRate(locals.user.id)) {
	  return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
	}
```

**Exact insertion point:** After line 10, before line 12 `const body = await request.json();`.

### Change D — `src/routes/api/predictions/tiebreaker/+server.ts`

Same pattern. Add import at top of file:
```typescript
import { checkPredictionRate } from '$lib/server/rate-limit.js';
```

Add rate check after auth guard in the POST handler (after line 30 `if (!locals.user) return ...`):
```typescript
	if (!checkPredictionRate(locals.user.id)) {
	  return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
	}
```

### SQL Migrations Needed

None.

### Dependency

None — create the new file first, then update the four endpoints.

---

## Fix 4 — WCP-12 / B6-3: Concurrent `calculateAllScores` Advisory Lock

**Finding IDs:** WCP-12 (Audit #1), B6-3 (Audit #2)
**Audit:** Audit #1, Audit #2, Audit #4 (M-04)
**Severity:** MEDIUM — Correctness / Race Condition
**File:** `src/lib/server/scoring.ts`
**Lines:** 286–335 (`calculateAllScores` function)

### Problem

`calculateAllScores` can be triggered concurrently from `admin/results`, `admin/sync-scores`, `admin/fifa-sync`, `admin/recalculate`, and `predictions/match-scores` — all for the same `poolId`. Under PostgreSQL `READ COMMITTED` isolation, two concurrent runs can each read the same group/bracket scores before either commits, then both write `total_score` based on partially-updated data. The last commit wins, potentially recording an under-counted score.

The fix uses `pg_try_advisory_xact_lock(poolId)` which is:
- Acquired inside the transaction (released automatically on `COMMIT`/`ROLLBACK`)
- Non-blocking: if already held, the second run returns immediately without error

### Old Code (`src/lib/server/scoring.ts:286–335` — `calculateAllScores` function)

```typescript
export async function calculateAllScores(poolId: number): Promise<void> {
	// M4: Fetch rules once — sub-functions receive them as a parameter
	const rules = await getScoringRules(poolId);

	// M5: Single transaction for all phases + total_score update
	const client = await getClient();
	try {
	  await client.query('BEGIN');

	  await calculateGroupScores(poolId, rules, client);
	  await calculateBracketScores(poolId, rules, client);
	  await calculateMatchScores(poolId, rules, client);

	  // Update total_score for all predictions in the pool (inside the same transaction)
	  await client.query(`
	    UPDATE predictions p SET
	      total_score = sub.total,
	      updated_at = NOW()
	    FROM (
	      SELECT pred.id,
	        COALESCE((SELECT SUM(gp.points_earned) FROM group_predictions gp WHERE gp.prediction_id = pred.id), 0) +
	        COALESCE((SELECT SUM(bp.points_earned) FROM bracket_predictions bp WHERE bp.prediction_id = pred.id), 0) +
	        COALESCE((SELECT SUM(mp.points_earned) FROM match_predictions mp WHERE mp.prediction_id = pred.id), 0) as total
	      FROM predictions pred
	      WHERE pred.pool_id = $1
	    ) sub
	    WHERE p.id = sub.id
	  `, [poolId]);

	  await client.query('COMMIT');

	  // Track successful scoring
	  await query(
	    'UPDATE pools SET last_scored_at = NOW(), last_score_error = NULL WHERE id = $1',
	    [poolId]
	  );
	} catch (err) {
	  await client.query('ROLLBACK');

	  // Track scoring failure
	  await query(
	    'UPDATE pools SET last_score_error = $2 WHERE id = $1',
	    [poolId, (err as Error).message ?? String(err)]
	  ).catch(() => {}); // don't let tracking failure mask the original error

	  throw err;
	} finally {
	  client.release();
	}
}
```

### New Code (`src/lib/server/scoring.ts:286–335`)

```typescript
export async function calculateAllScores(poolId: number): Promise<void> {
	// M4: Fetch rules once — sub-functions receive them as a parameter
	const rules = await getScoringRules(poolId);

	// M5: Single transaction for all phases + total_score update
	const client = await getClient();
	try {
	  await client.query('BEGIN');

	  // WCP-12/B6-3: Acquire a per-pool advisory lock (xact-scoped, released on COMMIT/ROLLBACK).
	  // pg_try_advisory_xact_lock returns false immediately if already held — no blocking.
	  // This serializes concurrent scoring runs for the same pool without queue contention.
	  const { rows: lockRows } = await client.query(
	    'SELECT pg_try_advisory_xact_lock($1) AS acquired',
	    [poolId]
	  );
	  if (!lockRows[0].acquired) {
	    // Another scoring run is already in progress for this pool — skip gracefully.
	    await client.query('ROLLBACK');
	    return;
	  }

	  await calculateGroupScores(poolId, rules, client);
	  await calculateBracketScores(poolId, rules, client);
	  await calculateMatchScores(poolId, rules, client);

	  // Update total_score for all predictions in the pool (inside the same transaction)
	  await client.query(`
	    UPDATE predictions p SET
	      total_score = sub.total,
	      updated_at = NOW()
	    FROM (
	      SELECT pred.id,
	        COALESCE((SELECT SUM(gp.points_earned) FROM group_predictions gp WHERE gp.prediction_id = pred.id), 0) +
	        COALESCE((SELECT SUM(bp.points_earned) FROM bracket_predictions bp WHERE bp.prediction_id = pred.id), 0) +
	        COALESCE((SELECT SUM(mp.points_earned) FROM match_predictions mp WHERE mp.prediction_id = pred.id), 0) as total
	      FROM predictions pred
	      WHERE pred.pool_id = $1
	    ) sub
	    WHERE p.id = sub.id
	  `, [poolId]);

	  await client.query('COMMIT');

	  // Track successful scoring
	  await query(
	    'UPDATE pools SET last_scored_at = NOW(), last_score_error = NULL WHERE id = $1',
	    [poolId]
	  );
	} catch (err) {
	  await client.query('ROLLBACK');

	  // Track scoring failure
	  await query(
	    'UPDATE pools SET last_score_error = $2 WHERE id = $1',
	    [poolId, (err as Error).message ?? String(err)]
	  ).catch(() => {}); // don't let tracking failure mask the original error

	  throw err;
	} finally {
	  client.release();
	}
}
```

### Exact Change

Only the new block is inserted after `await client.query('BEGIN');` and before the three `calculateXxx` calls. The lock is a 14-line addition; nothing else changes.

### SQL Migrations Needed

None — `pg_try_advisory_xact_lock` is a built-in PostgreSQL function, no migration required.

### Dependency

None — standalone change to scoring.ts.

---

## Fix 5 — B3-1: No Member Limit Enforcement

**Finding ID:** B3-1
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Business Logic
**File:** `src/routes/api/pools/join/+server.ts`
**Lines:** 4–22

### Problem

A pool has no upper bound on the number of members. In a paid buy-in pool, late joiners may enter after predictions close but before payment is confirmed, creating accounting inconsistencies. An unbounded pool also creates leaderboard and admin-page performance issues.

### Old Code (`src/routes/api/pools/join/+server.ts:4–22`)

```typescript
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

	try {
	  const { code } = await request.json();
	  if (!code) return json({ error: 'Código requerido' }, { status: 400 });

	  const pool = await getPoolByInvite(code.toUpperCase());
	  if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });

	  const joined = await joinPool(pool.id, locals.user.id);
	  if (!joined) return json({ error: 'Ya estás en esta quiniela' }, { status: 409 });

	  return json({ pool_id: pool.id });
	} catch (e) {
	  console.error('[api/pools/join] POST error:', e);
	  return json({ error: 'Internal server error' }, { status: 500 });
	}
};
```

### New Code (`src/routes/api/pools/join/+server.ts:4–22`)

```typescript
const MAX_POOL_MEMBERS = 200; // hard cap; adjust if pools need to be larger

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

	try {
	  const { code } = await request.json();
	  if (!code) return json({ error: 'Código requerido' }, { status: 400 });

	  const pool = await getPoolByInvite(code.toUpperCase());
	  if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });

	  // B3-1: Enforce member cap before joining
	  const { rows: countRows } = await query(
	    'SELECT COUNT(*) AS cnt FROM pool_members WHERE pool_id = $1',
	    [pool.id]
	  );
	  const memberCount = Number(countRows[0].cnt);
	  if (memberCount >= MAX_POOL_MEMBERS) {
	    return json({ error: `Esta quiniela ya tiene el máximo de ${MAX_POOL_MEMBERS} participantes` }, { status: 403 });
	  }

	  const joined = await joinPool(pool.id, locals.user.id);
	  if (!joined) return json({ error: 'Ya estás en esta quiniela' }, { status: 409 });

	  return json({ pool_id: pool.id });
	} catch (e) {
	  console.error('[api/pools/join] POST error:', e);
	  return json({ error: 'Internal server error' }, { status: 500 });
	}
};
```

Also add the `query` import at the top of file. Current line 1:
```typescript
import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
```

New line 1–2:
```typescript
import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
```

### SQL Migrations Needed

None. If you want the limit to be configurable per pool, add a `max_members INTEGER DEFAULT 200` column to pools table (separate migration, optional enhancement).

### Dependency

None — standalone.

---

## Fix 6 — B3-2: Public Leaderboard URL Exposes Invite Code

**Finding ID:** B3-2
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Security / Privacy
**Files:**
	- Migration: new SQL file `drizzle/migrations/0007_share_token.sql`
	- `src/lib/server/queries.ts` — new `getPoolByShareToken` function
	- `src/routes/s/[code]/+page.server.ts` — switch from invite_code to share_token lookup
	- `src/routes/pool/[id]/admin/+page.svelte` — display share URL using share_token (not invite_code)
	- `src/routes/pool/[id]/admin/+page.server.ts` — ensure share_token is returned in pool data

### Problem

`/s/{invite_code}` is the public leaderboard URL. Anyone who sees the URL in browser history, a screenshot, or a social share has the pool's join code and can join the pool — conflating "view leaderboard" with "ability to join." A separate `share_token` decouples viewing from joining.

### Step 1 — Migration: `drizzle/migrations/0007_share_token.sql` (NEW FILE)

```sql
-- 0007_share_token.sql
-- Adds a read-only share token to pools so the public leaderboard URL
-- no longer exposes the join invite_code.

ALTER TABLE pools ADD COLUMN IF NOT EXISTS share_token TEXT;

-- Backfill existing pools with a unique token derived from gen_random_uuid()
UPDATE pools SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;

-- Enforce uniqueness and NOT NULL after backfill
ALTER TABLE pools ALTER COLUMN share_token SET NOT NULL;
ALTER TABLE pools ADD CONSTRAINT pools_share_token_key UNIQUE (share_token);

-- Index for the /s/:share_token lookup
CREATE INDEX IF NOT EXISTS idx_pools_share_token ON pools(share_token);
```

Run this migration before any code changes.

### Step 2 — `src/lib/server/queries.ts` — Add `getPoolByShareToken`

Add after `getPoolByInvite` (after line 115):

```typescript
export async function getPoolByShareToken(token: string): Promise<Pool | null> {
	const { rows } = await query('SELECT * FROM pools WHERE share_token = $1', [token]);
	return (rows[0] as Pool) ?? null;
}
```

Also add `share_token: string` to the `Pool` interface in `src/lib/server/types.ts` after the existing fields (around line 15):
```typescript
	share_token: string;
```

### Step 3 — `src/routes/s/[code]/+page.server.ts` — Switch to share_token

**Old code (lines 1–9):**
```typescript
import { query } from '$lib/server/db.js';
import { getPoolLeaderboard, getScoringConfig } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';
import { getCachedPoolLeaderboard, setCachedPoolLeaderboard } from '$lib/server/cache.js';

export const load: PageServerLoad = async ({ params }) => {
	const { rows: poolRows } = await query('SELECT * FROM pools WHERE invite_code = $1', [params.code]);
	const pool = poolRows[0] ?? null;
	if (!pool) throw new Error('Quiniela no encontrada');
```

**New code (lines 1–9):**
```typescript
import { getPoolByShareToken, getPoolLeaderboard } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';
import { getCachedPoolLeaderboard, setCachedPoolLeaderboard } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	// B3-2: Use share_token (not invite_code) so public URL cannot be used to join
	const pool = await getPoolByShareToken(params.code);
	if (!pool) throw error(404, 'Quiniela no encontrada');
```

Remove the unused `import { query }` line and the unused `import { getScoringConfig }` if it was only used in the old version.

### Step 4 — Update Pool Creation to Generate `share_token`

In `src/lib/server/queries.ts`, update `createPool` (lines 69–111). After `const inviteCode = generateInviteCode();` (line 70), add:

```typescript
	const shareToken = crypto.randomUUID();
```

Then add `share_token` to the INSERT (line 77–79):

**Old INSERT (lines 76–80):**
```typescript
	const insertResult = await client.query(
	  `INSERT INTO pools (name, invite_code, created_by, buy_in, allow_multiple_predictions, currency)
	   VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
	  [name, inviteCode, createdBy, buyIn, allowMultiple, currency]
	);
```

**New INSERT:**
```typescript
	const insertResult = await client.query(
	  `INSERT INTO pools (name, invite_code, share_token, created_by, buy_in, allow_multiple_predictions, currency)
	   VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
	  [name, inviteCode, shareToken, createdBy, buyIn, allowMultiple, currency]
	);
```

### Step 5 — Update Admin Page to Show Share URL (not invite URL)

In `src/routes/pool/[id]/admin/+page.svelte`, find the section that displays the invite/share link. Search for `invite_code` in the template. Replace the share link display (shown to admin) to use `pool.share_token`:

**Old pattern (wherever invite_code is displayed as a shareable link):**
```svelte
	href="/s/{pool.invite_code}"
```
or
```svelte
	value={`${$page.url.origin}/s/${pool.invite_code}`}
```

**New pattern:**
```svelte
	href="/s/{pool.share_token}"
```
or
```svelte
	value={`${$page.url.origin}/s/${pool.share_token}`}
```

The **join link** (shown separately for inviting members) should still use `invite_code`:
```svelte
	href="/join/{pool.invite_code}"
```

### SQL Migrations Needed

`drizzle/migrations/0007_share_token.sql` — see Step 1 above. Must run before deploying code changes.

### Dependency

🔗 Run migration in Step 1 before deploying Steps 2–5.

---

## Fix 7 — B4-4: Per-Group Kickoff Deadline Filter

**Finding ID:** B4-4
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Correctness / UX
**File:** `src/routes/api/predictions/group/+server.ts`
**Lines:** 85–95

### Problem

The per-match kickoff check uses `WHERE group_name = ANY($1::text[]) … LIMIT 1`. If **any** submitted group has a started match, the entire save is rejected — including predictions for groups that haven't kicked off yet. For example, if Group A (Europe, Day 1) has started, users cannot update Group L (Americas, Day 3) predictions.

### Old Code (lines 85–95)

```typescript
	// Per-match kickoff deadline: reject if any match in these groups has already started
	const groupNames = Object.keys(groups);
	if (groupNames.length > 0) {
	  const { rows: started } = await query(
	    `SELECT 1 FROM matches WHERE group_name = ANY($1::text[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW() LIMIT 1`,
	    [groupNames]
	  );
	  if (started.length > 0) {
	    return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
	  }
	}
```

### New Code (lines 85–100)

```typescript
	// Per-match kickoff deadline: silently exclude groups whose matches have already started.
	// B4-4: Do NOT block the entire save — only skip the specific groups that are locked.
	// This allows a user editing Group L to save even if Group A has already kicked off.
	const groupNames = Object.keys(groups);
	if (groupNames.length > 0) {
	  const { rows: startedRows } = await query(
	    `SELECT DISTINCT group_name FROM matches
	     WHERE group_name = ANY($1::text[])
	       AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()`,
	    [groupNames]
	  );
	  const startedGroupSet = new Set(startedRows.map((r: any) => r.group_name));
	  if (startedGroupSet.size > 0) {
	    // Remove locked groups — the rest will be saved normally
	    for (const g of startedGroupSet) {
	      delete (groups as Record<string, unknown>)[g];
	    }
	  }
	}
	// If all submitted groups were locked, groups is now empty — the loop below is a no-op
	// and the response will be { ok: true } with nothing written (correct behaviour).
```

### Note on Return Type

The `groups` variable is typed as a `const` from the destructured `body`. You may need to re-assign or use a `let` binding. If TypeScript complains about deleting from a `const`, adjust the destructure:

```typescript
	// Change the destructure at line 49 from:
	const { prediction_id, groups } = body as { ... };
	// To:
	const { prediction_id, groups: rawGroups } = body as { ... };
	const groups = { ...rawGroups }; // mutable copy so we can delete started groups
```

### SQL Migrations Needed

None.

### Dependency

None — standalone. Coordinate with B5-2 (same pattern for bracket).

---

## Fix 8 — B5-2: Per-Phase Bracket Deadline Filter

**Finding ID:** B5-2
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Correctness / UX
**File:** `src/routes/api/predictions/bracket/+server.ts`
**Lines:** 89–99

### Problem

Same problem as B4-4 but for bracket phases. If the R32 phase has started, users cannot update their SF or Final predictions — even though those matches are weeks away.

### Old Code (lines 89–99)

```typescript
	// Per-match kickoff deadline: reject if any knockout match in the relevant phases has started
	const phases = Object.keys(picks);
	if (phases.length > 0) {
	  const { rows: started } = await query(
	    `SELECT 1 FROM matches WHERE phase = ANY($1::text[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW() LIMIT 1`,
	    [phases]
	  );
	  if (started.length > 0) {
	    return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
	  }
	}
```

### New Code (lines 89–104)

```typescript
	// Per-match kickoff deadline: silently exclude phases whose matches have started.
	// B5-2: Only lock the specific phases that have kicked off; allow saving later phases.
	const phases = Object.keys(picks);
	if (phases.length > 0) {
	  const { rows: startedRows } = await query(
	    `SELECT DISTINCT phase FROM matches
	     WHERE phase = ANY($1::text[])
	       AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()`,
	    [phases]
	  );
	  const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
	  if (startedPhaseSet.size > 0) {
	    // Remove locked phases — save the rest
	    for (const p of startedPhaseSet) {
	      delete (picks as Record<string, unknown>)[p];
	    }
	  }
	}
	// If picks is now empty after filtering, the loop below writes nothing — { ok: true } is returned.
```

Same TypeScript note as B4-4 if `picks` is typed as `const` — use a mutable copy:
```typescript
	const { prediction_id, picks: rawPicks } = body as { ... };
	const picks = { ...rawPicks };
```

### SQL Migrations Needed

None.

### Dependency

None — standalone. Coordinate with B4-4 (same pattern).

---

## Fix 9 — B5-3: Server-Side Bracket Consistency Validation

**Finding ID:** B5-3
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Data Integrity
**File:** `src/routes/api/predictions/bracket/+server.ts`
**Lines:** Insert after the existing `VALID_PHASES` slot-range checks (after line 128 `}`)

### Problem

The server accepts any team_id in any bracket slot without checking tournament progression. A user could (via direct API call) predict Germany in R16 but Argentina in QF simultaneously — even though bracket logic requires the QF team to be the winner of the R16 match that feeds it. The cascade logic exists only in the client.

### Pragmatic Approach

Full bracket-progression validation requires knowing the exact seeding bracket (which R16 slot feeds which QF slot), which is complex to implement correctly and maintain. The pragmatic server-side check:

1. **Intra-phase uniqueness**: A team cannot appear twice in the same phase (already enforced by the `UNIQUE(prediction_id, phase, slot)` constraint — no fix needed).
2. **Cross-phase consistency**: Any team that appears in phase `N+1` must also appear in the corresponding preceding phase `N`. This can be validated without knowing exact bracket seeding.

### New Code — Add after the existing team-ID validation block (after line 128)

Insert between the team validation block and the `const client = await getClient();` line (around line 130):

```typescript
	// B5-3: Cross-phase consistency check.
	// Any team picked in a later phase must also appear in the immediately preceding phase.
	// This catches direct-API abuse (e.g., pick Argentina in QF without picking them in R16).
	// Phase progression: r32 → r16 → qf → sf → final ; also sf → 3rd (third-place match)
	const PHASE_PROGRESSION: Record<string, string> = {
	  r16: 'r32',
	  qf: 'r16',
	  sf: 'qf',
	  final: 'sf',
	  '3rd': 'sf',
	};

	for (const [phase, slots] of Object.entries(picks)) {
	  const precedingPhase = PHASE_PROGRESSION[phase];
	  if (!precedingPhase) continue; // r32 has no preceding phase in the submitted payload

	  // Collect teams picked in this phase (excluding nulls)
	  const teamsInThisPhase = new Set(
	    Object.values(slots).filter((id): id is number => id !== null)
	  );

	  // Collect teams picked in the preceding phase (from the same request)
	  const precedingPicks = picks[precedingPhase] ?? {};
	  const teamsInPrecedingPhase = new Set(
	    Object.values(precedingPicks).filter((id): id is number => id !== null)
	  );

	  // If preceding phase picks were submitted, every team in the current phase
	  // must appear in the preceding phase.
	  if (teamsInPrecedingPhase.size > 0) {
	    for (const teamId of teamsInThisPhase) {
	      if (!teamsInPrecedingPhase.has(teamId)) {
	        return json({
	          error: `Equipo ${teamId} no fue seleccionado en la fase previa (${precedingPhase})`,
	        }, { status: 400 });
	      }
	    }
	  }
	}
```

### Edge Cases

- If the user submits only SF/Final without submitting R16/QF (e.g., a partial save), `teamsInPrecedingPhase.size === 0` and the check is skipped — correct, because we only validate consistency within a single request.
- After B5-2's phase-filtering (started phases are removed), this check runs on the remaining allowed phases only — consistent.

### SQL Migrations Needed

None.

### Dependency

🔗 Apply after B5-2 (phase filter) so the consistency check only runs on unlocked phases.

---

## Fix 10 — B6-2: Background Scoring Failures Visible to Admin

**Finding ID:** B6-2
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Observability
**Files:**
	- `src/routes/pool/[id]/admin/+page.server.ts` — lines 36–44 (return statement)
	- `src/routes/pool/[id]/admin/+page.svelte` — add display after stats section

### Problem

`calculateAllScores` stores errors in `pools.last_score_error` on failure (verified in `scoring.ts:327`). The `Pool` TypeScript interface already declares `last_score_error: string | null` (types.ts:22). But the admin page server load returns `pool` from `getPoolById` (which uses `SELECT *`, so `last_score_error` IS included), and the admin template never displays it. Admins believe scoring succeeded when it silently failed.

### Change A — `src/routes/pool/[id]/admin/+page.server.ts`

The pool returned by `getPoolById` already includes `last_score_error` (via `SELECT *`). No server-side change is needed — the data is already present in `data.pool`.

**Verification:** `src/lib/server/queries.ts:118-121`
```typescript
export async function getPoolById(id: number): Promise<Pool | null> {
  const { rows } = await query('SELECT * FROM pools WHERE id = $1', [id]);
  return (rows[0] as Pool) ?? null;
}
```
`SELECT *` returns all columns including `last_score_error`. The server load at `admin/+page.server.ts:10-11` calls `getPoolById(poolId)` and returns `{ pool, ... }`. So `data.pool.last_score_error` is already available on the client.

### Change B — `src/routes/pool/[id]/admin/+page.svelte`

Add a scoring error alert **after the stats section** (after the closing `</div>` of the stats grid, approximately after line 185).

Insert the following new block:
```svelte
	<!-- B6-2: Show scoring error banner if last score calculation failed -->
	{#if data.pool.last_score_error}
	  <div style="margin-bottom: 24px; padding: 14px 16px; background: rgba(255,77,106,0.12); border: 1px solid var(--red); border-radius: 8px;">
	    <div style="font-size: 11px; font-weight: 600; color: var(--red); margin-bottom: 6px;">
	      ⚠️ Error en el último cálculo de puntuación
	    </div>
	    <div style="font-size: 10px; color: var(--text-muted); font-family: monospace; word-break: break-word;">
	      {data.pool.last_score_error}
	    </div>
	    <div style="font-size: 9px; color: var(--text-dim); margin-top: 6px;">
	      El error se borrará automáticamente cuando la puntuación se recalcule con éxito.
	    </div>
	  </div>
	{/if}
```

**Exact insertion location:** After the closing `</div>` of the stats grid (search for the line `<!-- Prize Distribution -->` — insert before it).

### SQL Migrations Needed

None — `last_score_error` column already exists (scoring.ts uses it).

### Dependency

None — standalone. Note: Fix 4 (WCP-12 advisory lock) reduces the frequency of scoring failures, making this display less common in practice.

---

## Fix 11 — 8a: Deadline Passes Mid-Session; Inputs Stay Enabled

**Finding ID:** 8a (Edge Case)
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — UX / Correctness
**File:** `src/routes/pool/[id]/predict/+page.svelte`
**Lines:** ~21 (script section) and ~379–388 (template section)

### Problem

`data.isLocked` is set server-side at page-load time. The client-side countdown timer updates every 30 seconds and sets `countdown = 'Cerrado'` when the deadline passes. But the drag/tap handlers still check `data.isLocked` (frozen at page load), so inputs remain enabled after the deadline passes mid-session. When the user auto-saves (still running from before deadline), the API correctly rejects with 403 — but the error is silently swallowed.

### Change A — Add `effectivelyLocked` derived state (script section)

Add the following `$derived` immediately after the `countdown` state declaration (after line 21 `let countdown = $state('');`):

```javascript
	// 8a: Client-side lock — true if server locked at page load OR if countdown reached zero.
	// This ensures inputs are disabled even if the deadline passes after the page is loaded.
	const effectivelyLocked = $derived(data.isLocked || countdown === 'Cerrado');
```

### Change B — Update drag handler guards (script section, lines 98, 106, 112, 124)

**Old (4 occurrences):**
```javascript
	if (data.isLocked) return;
```

**New (replace all 4):**
```javascript
	if (effectivelyLocked) return;
```

The four locations are:
	- Line 98: inside `handleDragStart`
	- Line 106: inside `handleDragStartUnassigned`
	- Line 112: inside `handleDragOver`
	- Line 124: inside `handleDrop`

### Change C — Update template conditional blocks (lines 379–388)

**Old code (lines 379–388):**
```svelte
	{#if countdown && !data.isLocked}
	  <div style="margin-top: 8px; padding: 8px 12px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 6px; font-size: 10px; color: var(--gold);">
	    ⏰ Cierre en: {countdown}
	  </div>
	{/if}
	{#if data.isLocked}
	  <div style="margin-top: 8px; padding: 8px 12px; background: rgba(255,77,106,0.1); border: 1px solid var(--red); border-radius: 6px; font-size: 10px; color: var(--red);">
	    ⚠️ Los pronósticos están bloqueados — la fecha límite ha pasado.
	  </div>
	{/if}
```

**New code (lines 379–388):**
```svelte
	{#if countdown && countdown !== 'Cerrado' && !effectivelyLocked}
	  <div style="margin-top: 8px; padding: 8px 12px; background: rgba(201,168,76,0.1); border: 1px solid var(--gold); border-radius: 6px; font-size: 10px; color: var(--gold);">
	    ⏰ Cierre en: {countdown}
	  </div>
	{/if}
	{#if effectivelyLocked}
	  <div style="margin-top: 8px; padding: 8px 12px; background: rgba(255,77,106,0.1); border: 1px solid var(--red); border-radius: 6px; font-size: 10px; color: var(--red);">
	    ⚠️ Los pronósticos están bloqueados — la fecha límite ha pasado.
	  </div>
	{/if}
```

### Why This Works

- When `countdown === 'Cerrado'` (deadline passed mid-session), `effectivelyLocked` becomes `true`
- All drag handlers immediately return without action
- The locked banner appears even without a page reload
- The countdown timer div is hidden (showing a timer for a closed deadline is confusing)
- The API's 403 rejection acts as a secondary enforcement layer

### SQL Migrations Needed

None.

### Dependency

None — standalone client-side change.

---

## Fix 12 — 8d: Deterministic Final Tiebreaker in Pool Leaderboard

**Finding ID:** 8d (Edge Case)
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Fairness / UX
**File:** `src/routes/pool/[id]/+page.server.ts`
**Lines:** 113–116

### Problem

When two users have identical `total_score`, `total_correct`, and `tiebreaker_close` (e.g., both have `9999` because neither filled in a tiebreaker), PostgreSQL's sort is not stable for equal rows — the ranking changes arbitrarily between page loads. This makes tied results feel unfair. A deterministic final tiebreaker (first-submitted wins) eliminates the ambiguity.

### Old Code (lines 113–116)

```typescript
	// Sort: total_score DESC, then total_correct DESC, then tiebreaker closeness ASC
	enrichedLeaderboard.sort((a: any, b: any) =>
	  b.total_score - a.total_score || b.total_correct - a.total_correct || a.tiebreaker_close - b.tiebreaker_close
	);
```

### New Code (lines 113–117)

```typescript
	// Sort: total_score DESC, total_correct DESC, tiebreaker closeness ASC,
	// then updated_at ASC as final deterministic tiebreaker (first-submitted wins).
	// 8d: updated_at is already returned via getPoolLeaderboard's SELECT *.
	enrichedLeaderboard.sort((a: any, b: any) =>
	  b.total_score - a.total_score ||
	  b.total_correct - a.total_correct ||
	  a.tiebreaker_close - b.tiebreaker_close ||
	  new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
	);
```

### Notes

- `a.updated_at` is already available: `getPoolLeaderboard` does `SELECT *` on predictions, which includes `updated_at`.
- `new Date(null).getTime()` returns `NaN` which sorts to the end — if somehow `updated_at` is null, those entries go last, which is acceptable.

### SQL Migrations Needed

None.

### Dependency

🔗 Apply before Fix 13 (8e) so the same sort logic can be consistently applied.

---

## Fix 13 — 8e: Leaderboard Sort Order Inconsistency Between Pool Page and `/s/` URL

**Finding ID:** 8e (Edge Case)
**Audit:** Audit #2 (WORLD-CUP-AUDIT-E2E.md)
**Severity:** MEDIUM — Correctness / UX
**File:** `src/routes/s/[code]/+page.server.ts`
**Lines:** 14–66

### Problem

The pool-level leaderboard (`/pool/[id]/`) sorts by `total_score → total_correct → tiebreaker_close → updated_at`. The public leaderboard (`/s/[share_token]/`) sorts by only `total_score → total_correct` (line 56: `enriched.sort((a, b) => b.total_score - a.total_score || b.total_correct - a.total_correct)`). The same pool can show a different ranked order in the two views, which is confusing for users comparing positions.

Also, the public leaderboard uses a manual `IN (${ph})` string with individually enumerated `$N` placeholders, whereas the pool page correctly uses `ANY($1::int[])` — divergent query patterns.

### Change — Replace sort and enrichment in `src/routes/s/[code]/+page.server.ts`

**Old code (lines 16–56): enrichment + sort**

```typescript
	const leaderboard = await getPoolLeaderboard(pool.id);

	// F-19: Bulk-fetch enrichment data to eliminate N+1 queries
	const predIds = leaderboard.map((e: any) => e.id);
	let groupCorrectMap: Record<number, number> = {};
	let bracketByPredPhase: Record<number, Record<string, number>> = {};

	if (predIds.length > 0) {
	  const ph = predIds.map((_, i) => `$${i + 1}`).join(',');

	  const { rows: gcRows } = await query(`
	    SELECT prediction_id, COUNT(*) as cnt
	    FROM group_predictions
	    WHERE prediction_id IN (${ph}) AND points_earned > 0
	    GROUP BY prediction_id
	  `, predIds);
	  gcRows.forEach(r => { groupCorrectMap[r.prediction_id] = r.cnt; });

	  const { rows: brRows } = await query(`
	    SELECT prediction_id, phase, points_earned
	    FROM bracket_predictions WHERE prediction_id IN (${ph})
	  `, predIds);
	  brRows.forEach(br => {
	    if (br.points_earned > 0) {
	      if (!bracketByPredPhase[br.prediction_id]) bracketByPredPhase[br.prediction_id] = {};
	      bracketByPredPhase[br.prediction_id][br.phase] = (bracketByPredPhase[br.prediction_id][br.phase] || 0) + 1;
	    }
	  });
	}

	const enriched = leaderboard.map((entry: any) => {
	  const predId = entry.id;
	  const groupCorrect = groupCorrectMap[predId] ?? 0;
	  const bracketByPhase = bracketByPredPhase[predId] ?? {};
	  return {
	    ...entry,
	    group_correct: groupCorrect,
	    bracket_correct: bracketByPhase,
	    total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
	  };
	});

	enriched.sort((a: any, b: any) => b.total_score - a.total_score || b.total_correct - a.total_correct);
```

**New code (lines 16–66): uses ANY parameterization, adds tiebreaker_close + updated_at to sort**

```typescript
	const leaderboard = await getPoolLeaderboard(pool.id);

	// Get the actual final match score for tiebreaker closeness (matches pool/[id] enrichment)
	const { rows: fmRows } = await query(`
	  SELECT home_score, away_score FROM matches
	  WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
	  LIMIT 1
	`);
	const finalMatch = fmRows[0] ?? null;

	const predIds = leaderboard.map((e: any) => e.id);
	let groupCorrectMap: Record<number, number> = {};
	let bracketByPredPhase: Record<number, Record<string, number>> = {};
	let tiebreakerMap: Record<number, any> = {};

	if (predIds.length > 0) {
	  // Use ANY($1::int[]) — same pattern as pool/[id]/+page.server.ts
	  const { rows: gcRows } = await query(`
	    SELECT prediction_id, COUNT(*) as cnt
	    FROM group_predictions
	    WHERE prediction_id = ANY($1::int[]) AND points_earned > 0
	    GROUP BY prediction_id
	  `, [predIds]);
	  gcRows.forEach((r: any) => { groupCorrectMap[r.prediction_id] = Number(r.cnt); });

	  const { rows: brRows } = await query(`
	    SELECT prediction_id, phase, points_earned
	    FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
	  `, [predIds]);
	  brRows.forEach((br: any) => {
	    if (br.points_earned > 0) {
	      if (!bracketByPredPhase[br.prediction_id]) bracketByPredPhase[br.prediction_id] = {};
	      bracketByPredPhase[br.prediction_id][br.phase] = (bracketByPredPhase[br.prediction_id][br.phase] || 0) + 1;
	    }
	  });

	  const { rows: tbRows } = await query(`
	    SELECT prediction_id, home_score, away_score
	    FROM tiebreaker WHERE prediction_id = ANY($1::int[])
	  `, [predIds]);
	  tbRows.forEach((tb: any) => { tiebreakerMap[tb.prediction_id] = tb; });
	}

	const enriched = leaderboard.map((entry: any) => {
	  const predId = entry.id;
	  const groupCorrect = groupCorrectMap[predId] ?? 0;
	  const bracketByPhase = bracketByPredPhase[predId] ?? {};
	  let tiebreakerClose = 9999;
	  if (finalMatch) {
	    const tb = tiebreakerMap[predId];
	    if (tb?.home_score != null && tb?.away_score != null) {
	      tiebreakerClose = Math.abs(tb.home_score - finalMatch.home_score) + Math.abs(tb.away_score - finalMatch.away_score);
	    }
	  }
	  return {
	    ...entry,
	    group_correct: groupCorrect,
	    bracket_correct: bracketByPhase,
	    total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
	    tiebreaker_close: tiebreakerClose,
	  };
	});

	// 8e: Use identical sort criteria as pool/[id]/+page.server.ts
	// total_score DESC → total_correct DESC → tiebreaker_close ASC → updated_at ASC
	enriched.sort((a: any, b: any) =>
	  b.total_score - a.total_score ||
	  b.total_correct - a.total_correct ||
	  a.tiebreaker_close - b.tiebreaker_close ||
	  new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
	);
```

Also remove the now-unused `query` import if you migrate from the old manual `IN (${ph})` approach, and remove the `import { getScoringConfig }` if it was removed in Fix 6 (B3-2). The new code re-uses `query` for the `fmRows` fetch, so keep the import.

### Update the cached result object

The old code (line 61–65) returned:
```typescript
	const result = {
	  pool: { id: pool.id, name: pool.name, buy_in: pool.buy_in },
	  leaderboard: enriched,
	  memberCount: memberCount.cnt,
	};
```

No change needed to the result shape — `tiebreaker_close` is added to each entry but the consuming template can simply ignore it if not displayed.

### SQL Migrations Needed

None.

### Dependency

🔗 Apply after Fix 12 (8d) to ensure the sort criteria are identical across both views.

---

## Summary: Migrations Required

Only one migration is needed across all fixes:

| Migration File | Needed For | Contents |
|---|---|---|
| `drizzle/migrations/0007_share_token.sql` | B3-2 (Fix 6) | ADD COLUMN share_token + UNIQUE index + backfill existing rows |

All other fixes are pure code changes — no schema alterations.

---

## Summary: New Files Created

| File | Needed For |
|---|---|
| `src/lib/server/rate-limit.ts` | WCP-11 (Fix 3) |
| `drizzle/migrations/0007_share_token.sql` | B3-2 (Fix 6) |

---

## Testing Checklist

After applying each fix:

| Fix | Verification |
|-----|-------------|
| WCP-08 | Delete the final match row from DB, reload `/leaderboard` — should not 500. Re-insert with NULL scores — same. |
| WCP-09 | Open `/pool/{id}/admin`, click a payment toggle — should still work. Check member rows in network tab: `user_id` key present, `od_user_id` absent. |
| WCP-11 | Send 31 rapid POSTs to `/api/predictions/group` within 60s — 31st should return 429. |
| WCP-12/B6-3 | Trigger two simultaneous score calculations for same pool (curl race) — both should complete without error; final `total_score` should be consistent. |
| B3-1 | Join a pool that already has 200 members — should return 403 with member-limit message. |
| B3-2 | Visit `/s/{old_invite_code}` — should return 404. Visit `/s/{share_token}` — should work. Joining via share URL should be impossible (join URL still uses invite_code). |
| B4-4 | Mark one group's match as started (set `kickoff_time` to past). Save predictions for a different group — should succeed. The started group's predictions should NOT be saved. |
| B5-2 | Mark R32 match as started. Save SF predictions only — should succeed. |
| B5-3 | POST bracket with R16 team that doesn't appear in R32 — should return 400 consistency error. |
| B6-2 | Force a scoring failure (e.g., corrupt `pool_id`), trigger recalculate — admin page should show the error banner. Fix the issue, recalculate — banner should disappear. |
| 8a | Open predict page before deadline. Wait for deadline to pass (or manually set countdown to expired). Drag a team — should be ignored. Locked banner should appear without page reload. |
| 8d | Create two entries with identical scores. Force `updated_at` to differ by seconds. Leaderboard should consistently rank the earlier-updated entry first. |
| 8e | Compare `/pool/{id}` leaderboard order with `/s/{share_token}` for the same pool — order must match. |
