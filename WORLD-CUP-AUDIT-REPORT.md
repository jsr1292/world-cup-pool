# World Cup Pool — Comprehensive Security & Correctness Audit Report
**Date:** 2026-05-27  
**Auditor:** Claude Sonnet 4.6  
**Scope:** All source files under `src/` (5th audit round, following commits c8b1bcf, 6515237, 34c75ae, 60bfc26)

---

## Summary Table

| ID | Severity | Category | File | Description |
|----|----------|----------|------|-------------|
| WCP-01 | 🔴 CRITICAL | Correctness | `api/predictions/group/+server.ts:117` | COUNT(*) returns string; strict `!==` comparison breaks all group prediction saves |
| WCP-02 | 🟠 HIGH | Correctness | `routes/pool/[id]/+page.server.ts:132` | ORDER BY uses `m.kickoff` but schema column is `kickoff_time` — query fails |
| WCP-03 | 🟠 HIGH | Reactivity | `routes/pool/[id]/predict/+page.svelte:12` | Progress bar reads stale `data.existingGroupPreds` instead of reactive `selections` |
| WCP-04 | 🟠 HIGH | Correctness | `routes/pool/[id]/predict/+page.svelte:421` | `groupDone` template var reads stale server data; group "Completo" badge never updates live |
| WCP-05 | 🟠 HIGH | Security | `lib/server/db.ts:3` | No `pool.on('error')` handler — idle pg client errors crash Node.js process |
| WCP-06 | 🟠 HIGH | Correctness | Multiple `+page.server.ts` files | `throw new Error()` instead of `throw error(404)` — wrong HTTP status codes |
| WCP-07 | 🟠 HIGH | Correctness | `routes/pool/[id]/predict/+page.svelte:574` | UI hardcodes "+2 pts / +5 pts" but default scoring config is match_outcome=1, exact_score=3 |
| WCP-08 | 🟡 MEDIUM | Security | `leaderboard/+page.server.ts:22` | Tiebreaker SQL constructed from DB values — NaN produces invalid SQL; violates defence-in-depth |
| WCP-09 | 🟡 MEDIUM | Correctness | `lib/server/queries.ts:154` | Typo `od_user_id` alias in `getPoolMembers` — downstream `member.user_id` access returns undefined |
| WCP-10 | 🟡 MEDIUM | Security | `api/predictions/entry/+server.ts:24` | TOCTOU race condition bypasses `allow_multiple=false` enforcement |
| WCP-11 | 🟡 MEDIUM | Security | Multiple prediction API routes | No rate limiting on prediction endpoints; concurrent submissions exhaust DB pool via cascading scoring |
| WCP-12 | 🟡 MEDIUM | Correctness | `api/admin/sync-scores/+server.ts:23` | Concurrent `calculateAllScores` runs for same pool are not serialized; race produces wrong `total_score` |
| WCP-13 | 🟡 MEDIUM | Security | `api/pools/+server.ts:32` | Missing max-length validation on pool name; missing max-length on prediction label |
| WCP-14 | 🟡 MEDIUM | Security | `lib/server/db.ts:4` | `DATABASE_URL` not validated at startup; failure surfaces as first-request DB error, not boot error |
| WCP-15 | 🟢 LOW | Performance | `routes/pool/[id]/summary/+page.server.ts:22` | N+1 queries: 2 DB calls per prediction entry in a loop |
| WCP-16 | 🟢 LOW | Correctness | `lib/server/types.ts:21` | `Pool` interface declares `allow_multiple: boolean` but actual DB column is `allow_multiple_predictions` |
| WCP-17 | 🟢 LOW | Security | `lib/server/cache.ts` | In-process session/leaderboard caches don't scale horizontally (already documented; Redis needed) |
| WCP-18 | 🟢 LOW | Reactivity | `routes/pool/[id]/predict/+page.svelte:181` | Auto-save swallows errors silently; user sees no feedback on repeated save failures |

---

## CRITICAL Findings

---

### WCP-01 — COUNT(*) Type Mismatch Breaks All Group Prediction Saves
**Severity:** 🔴 CRITICAL  
**Category:** Correctness  
**File:** `src/routes/api/predictions/group/+server.ts:113–119`

**Description:**  
The `pg` driver returns PostgreSQL `COUNT(*)` (which returns `bigint` / OID 20) as a **JavaScript string** (`"4"` not `4`) to avoid int64 precision loss. The comparison on line 117 uses strict inequality (`!==`), so `"4" !== 4` evaluates to `true`. This means the validation block **always fires** for any group where at least one team is selected, rejecting 100% of valid group predictions with `"Equipo inválido en grupo X"`.

```typescript
// src/routes/api/predictions/group/+server.ts:113-119
const { rows: validRows } = await query(
  `SELECT COUNT(*) as cnt FROM teams WHERE group_name = $1 AND id = ANY($2::int[])`,
  [groupName, filled]
);
if (validRows[0].cnt !== filled.length) {   // ← "4" !== 4 is always true
  return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
}
```

**Suggested fix:**
```typescript
// Cast the pg bigint string to number before comparing
if (Number(validRows[0].cnt) !== filled.length) {
  return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
}
```

---

## HIGH Findings

---

### WCP-02 — `m.kickoff` Column Doesn't Exist; Should Be `m.kickoff_time`
**Severity:** 🟠 HIGH  
**Category:** Correctness  
**Files:**  
- `src/routes/pool/[id]/+page.server.ts:132`  
- `src/routes/pool/[id]/results/+page.server.ts:17`  
- `src/routes/pool/[id]/admin/+page.server.ts:28`

**Description:**  
Three server-side `ORDER BY` clauses reference `m.kickoff`, but every other query in the codebase (deadline enforcement in `group/+server.ts`, `bracket/+server.ts`, `match-scores/+server.ts`, and the `live-scores.ts` updater) consistently uses `kickoff_time`. The `types.ts` `Match` interface also declares `kickoff_time: Date | null`. PostgreSQL will throw `column "kickoff" does not exist`, making the pool home page, results tab, and admin page fail with 500 on first load (before the cache warms).

```typescript
// src/routes/pool/[id]/+page.server.ts:130-133 — BROKEN
const { rows: matchRows } = await query(`
  SELECT m.*, ht.name as home_name ...
  ORDER BY m.sort_order, m.kickoff   -- ← column does not exist
`);
```

**Suggested fix:**
```typescript
// All three files: replace m.kickoff with m.kickoff_time
ORDER BY m.sort_order, m.kickoff_time
```

---

### WCP-03 — Progress Bar Reads Stale `data.existingGroupPreds` Instead of Reactive `selections`
**Severity:** 🟠 HIGH  
**Category:** Reactivity (Svelte 5)  
**File:** `src/routes/pool/[id]/predict/+page.svelte:12–17`

**Description:**  
`groupsCompleted` is a `$derived` that reads `data.existingGroupPreds` — server-loaded data that never changes after page load. But the user's active selections are stored in the `$state` variable `selections`. After the user drags/taps teams into position and auto-save fires, `selections` is updated and persisted to the server, but the progress bar (and the `{groupsCompleted}/12 grupos` counter) never reflects the change until a full page reload.

```typescript
// src/routes/pool/[id]/predict/+page.svelte:12-17 — BUG
const groupsCompleted = $derived.by(() => {
  return GROUP_NAMES.filter(g => {
    const gp = data.existingGroupPreds?.[g];   // ← stale server snapshot
    return gp?.pos1 && gp?.pos2 && gp?.pos3 && gp?.pos4;
  }).length;
});
```

**Suggested fix:**
```typescript
// Derive from the reactive selections $state instead
const groupsCompleted = $derived.by(() => {
  return GROUP_NAMES.filter(g => {
    const arr = selections[g] || [];
    return arr[0] != null && arr[1] != null && arr[2] != null && arr[3] != null;
  }).length;
});
```

---

### WCP-04 — `groupDone` Template Variable Also Reads Stale Server Data
**Severity:** 🟠 HIGH  
**Category:** Reactivity (Svelte 5)  
**File:** `src/routes/pool/[id]/predict/+page.svelte:421–422`

**Description:**  
Inside the `{#each GROUP_NAMES as group}` loop, `groupDone` is computed from `data.existingGroupPreds` rather than `selections`. This means the group card border colour, the "✓ Completo" badge, and the mobile "Reset" button visibility all reflect the stale server snapshot — not the user's current in-progress selections.

```svelte
<!-- src/routes/pool/[id]/predict/+page.svelte:421-422 — BUG -->
{@const gp = data.existingGroupPreds?.[group]}
{@const groupDone = !!(gp?.pos1 && gp?.pos2 && gp?.pos3 && gp?.pos4)}
```

**Suggested fix:**
```svelte
<!-- Derive groupDone from the reactive selections state -->
{@const arr = selections[group] || []}
{@const groupDone = arr[0] != null && arr[1] != null && arr[2] != null && arr[3] != null}
```

---

### WCP-05 — Missing `pool.on('error')` Handler Crashes Node.js Process
**Severity:** 🟠 HIGH  
**Category:** Security / Reliability  
**File:** `src/lib/server/db.ts:3–6`

**Description:**  
The `pg.Pool` emits an `'error'` event when an idle client encounters an unexpected error (e.g., server-side connection reset). In Node.js, an unhandled `EventEmitter` `'error'` event is treated as an uncaught exception and **terminates the process**. The current setup has no handler.

```typescript
// src/lib/server/db.ts:3-6 — MISSING error handler
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10
});
// No pool.on('error', ...) — idle errors crash the server
```

**Suggested fix:**
```typescript
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

pool.on('error', (err, client) => {
  console.error('[db] Unexpected idle client error:', err.message);
  // Do NOT rethrow — just log. The pool will remove the broken client automatically.
});
```

---

### WCP-06 — `throw new Error()` Returns 500; Should Be `throw error(404)`
**Severity:** 🟠 HIGH  
**Category:** Correctness  
**Files:**
- `src/routes/pool/[id]/+page.server.ts:9`
- `src/routes/pool/[id]/results/+page.server.ts:8`
- `src/routes/pool/[id]/summary/+page.server.ts:8`

**Description:**  
Three page servers throw a raw `Error` when a pool is not found. SvelteKit does not convert raw `Error` objects to HTTP errors — they surface as 500 Internal Server Error (or, in dev, expose the stack trace). The correct pattern is SvelteKit's `error()` helper which produces a proper 404. By contrast, `bracket/+page.server.ts` and `admin/+page.server.ts` already use `throw error(404, ...)` correctly.

```typescript
// src/routes/pool/[id]/+page.server.ts:8-9 — WRONG
const pool = await getPoolById(poolId);
if (!pool) throw new Error('Quiniela no encontrada');  // → HTTP 500
```

**Suggested fix:**
```typescript
import { error } from '@sveltejs/kit';

const pool = await getPoolById(poolId);
if (!pool) throw error(404, 'Quiniela no encontrada');  // → HTTP 404
```

Apply the same fix in `results/+page.server.ts:8` and `summary/+page.server.ts:8`.

---

### WCP-07 — UI Hardcodes Scoring Points That Don't Match Default Config
**Severity:** 🟠 HIGH  
**Category:** Correctness  
**File:** `src/routes/pool/[id]/predict/+page.svelte:573–576`

**Description:**  
The knockout match scores section hardcodes "+2 pts" for correct outcome and "+5 pts" for exact score. The actual default scoring config (inserted by `createPool` in `queries.ts:88-98` and used by `calculateMatchScores`) is `match_outcome=1` and `exact_score=3`. Combined, a correct outcome scores 1 pt and an exact score scores 1+3=4 pts — **not 2 and 5**. This misinforms every user about the real point values.

```svelte
<!-- src/routes/pool/[id]/predict/+page.svelte:573-576 — WRONG hardcoded values -->
<p>Acierta el resultado (1/X/2): <strong>+2 pts</strong> · Marcador exacto: <strong>+5 pts</strong></p>
```

**Suggested fix** (pass scoring config from server load and display configured values):

In `predict/+page.server.ts`, add to return:
```typescript
const scoring = await getScoringConfig(poolId);
return { ..., scoring };
```

In `predict/+page.svelte`:
```svelte
<p>
  Acierta el resultado (1/X/2):
  <strong>+{data.scoring.match_outcome ?? 1} pts</strong> ·
  Marcador exacto:
  <strong>+{(data.scoring.match_outcome ?? 1) + (data.scoring.exact_score ?? 3)} pts</strong>
</p>
```

---

## MEDIUM Findings

---

### WCP-08 — Tiebreaker SQL Built from Database Values (`NaN` Produces Invalid SQL)
**Severity:** 🟡 MEDIUM  
**Category:** Security  
**File:** `src/routes/leaderboard/+page.server.ts:22–30`

**Description:**  
`finalMatch.home_score` and `finalMatch.away_score` are read from the DB and interpolated directly into a SQL string. `Math.trunc(Number(x))` is not sufficient sanitisation: if `x` is `null`, `Number(null)` = `0` (fine), but if somehow `x` is `undefined`, `Number(undefined)` = `NaN`, and `Math.trunc(NaN)` = `NaN`, which when embedded in SQL yields `ABS(tb.home_score - NaN)` — invalid PostgreSQL syntax causing a 500. Even if the admin API validates scores on write, this is a violation of defence-in-depth: SQL should never be built from DB-sourced values.

```typescript
// src/routes/leaderboard/+page.server.ts:22-30 — SQL from DB values
const h = Math.trunc(Number(finalMatch.home_score));
const a = Math.trunc(Number(finalMatch.away_score));
orderByTiebreaker = `(
  COALESCE(ABS(tb.home_score - ${h}) + ABS(tb.away_score - ${a}), 9999)
)`;
// ...
const { rows } = await query(`WITH tiebreaker_close AS (
  SELECT prediction_id, ${orderByTiebreaker} as closeness ...`);
```

**Suggested fix** — guard with `Number.isInteger` and pass as query parameters:
```typescript
const hRaw = Number(finalMatch.home_score);
const aRaw = Number(finalMatch.away_score);
if (Number.isInteger(hRaw) && Number.isInteger(aRaw)) {
  // Pass as parameters — no interpolation
  const { rows } = await query(`
    WITH tiebreaker_close AS (
      SELECT prediction_id,
        COALESCE(ABS(tb.home_score - $1) + ABS(tb.away_score - $2), 9999) as closeness
      FROM tiebreaker tb
    ), ...
    ORDER BY total_score DESC, exact_score_hits DESC, total_correct DESC, tc.closeness ASC
    LIMIT 100
  `, [hRaw, aRaw, /* other params */]);
}
```
(Refactor the CTE to accept the two score parameters; use `9999` as literal constant since it's not user-supplied.)

---

### WCP-09 — Typo `od_user_id` in `getPoolMembers` Alias
**Severity:** 🟡 MEDIUM  
**Category:** Correctness  
**File:** `src/lib/server/queries.ts:154`

**Description:**  
The alias for `u.id` in `getPoolMembers` is `od_user_id` (likely a typo for `user_id`). Any downstream code accessing `member.user_id` receives `undefined`, while the actual value lives under `member.od_user_id`. The pool admin page sends `user_id` in payment toggle requests; if it reads from `member.user_id`, the payment API receives `undefined` and silently fails (or updates 0 rows).

```typescript
// src/lib/server/queries.ts:154 — TYPO
`SELECT u.id as od_user_id, u.username, u.display_name, ...`
//              ^^^^^^^^^^^  should be user_id
```

**Suggested fix:**
```typescript
`SELECT u.id as user_id, u.username, u.display_name,
  pr.id as entry_id, pr.label as entry_label, pr.total_score,
  COALESCE(pr.has_paid, pm.has_paid, FALSE) as has_paid,
  pm.joined_at
FROM pool_members pm
...`
```

---

### WCP-10 — TOCTOU Race Condition Bypasses `allow_multiple=false` Enforcement
**Severity:** 🟡 MEDIUM  
**Category:** Security / Correctness  
**File:** `src/routes/api/predictions/entry/+server.ts:24–32`

**Description:**  
The check for whether a user already has a prediction (when `allow_multiple_predictions=false`) is a read followed by an insert — two separate operations with no database-level lock between them. Two concurrent POST requests can both pass the check (finding 0 existing entries) and both proceed to `createPrediction`. If they use different labels, the `ON CONFLICT (user_id, pool_id, label)` constraint doesn't fire, and two entries are created despite `allow_multiple=false`.

```typescript
// src/routes/api/predictions/entry/+server.ts:24-32 — TOCTOU
if (!pool.allow_multiple_predictions) {
  const { rows: existingRows } = await query(    // ← read
    'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2',
    [pool_id, locals.user.id]
  );
  if (existingRows.length > 0) { ... return 403; }
}
// Gap here — concurrent request can also pass the check
const result = await createPrediction(pool_id, locals.user.id, label);  // ← write
```

**Suggested fix** — enforce the constraint at the database level with a partial unique index, or use an advisory lock:
```sql
-- Migration: add a partial unique index for single-entry pools
-- This is enforced atomically by PostgreSQL, eliminating the race
CREATE UNIQUE INDEX predictions_single_entry_uq
  ON predictions (user_id, pool_id)
  WHERE label = '';
```
Or, add a DB-level check constraint that fires on the INSERT itself:
```typescript
// In createPrediction, handle the unique violation for single-entry pools
try {
  const { rows } = await query(
    `INSERT INTO predictions (user_id, pool_id, label, total_score)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [userId, poolId, label]
  );
  return { rows };
} catch (e: any) {
  if (e.code === '23505') return null; // unique violation — already exists
  throw e;
}
```

---

### WCP-11 — No Rate Limiting on Prediction Submission Endpoints
**Severity:** 🟡 MEDIUM  
**Category:** Security  
**Files:**  
- `src/routes/api/predictions/group/+server.ts`  
- `src/routes/api/predictions/bracket/+server.ts`  
- `src/routes/api/predictions/match-scores/+server.ts`  
- `src/routes/api/predictions/tiebreaker/+server.ts`

**Description:**  
Auth endpoints have a 10-request/15-minute rate limit (in `api/auth/[action]/+server.ts`). None of the prediction submission endpoints have any rate limiting. Each `match-scores` POST triggers `setImmediate(calculateAllScores)`, which acquires a DB connection, runs 3 bulk UPDATEs plus a total-score aggregate, all inside a transaction. A user who rapidly submits predictions (or an automated script) could queue hundreds of scoring jobs, exhausting the 10-connection pool and starving other requests.

**Suggested fix** — add a shared rate-limiter (reuse the auth module's pattern):
```typescript
// src/lib/server/rate-limit.ts (new file)
const _predLimits = new Map<number, { count: number; resetAt: number }>();
const PRED_LIMIT = 30; // 30 saves per minute per user
const PRED_WINDOW = 60_000;

export function checkPredictionRate(userId: number): boolean {
  const now = Date.now();
  const e = _predLimits.get(userId);
  if (!e || now > e.resetAt) {
    _predLimits.set(userId, { count: 1, resetAt: now + PRED_WINDOW });
    return true;
  }
  if (e.count >= PRED_LIMIT) return false;
  e.count++;
  return true;
}
```
Then at the top of each prediction handler:
```typescript
if (!checkPredictionRate(locals.user.id)) {
  return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
}
```

---

### WCP-12 — Concurrent `calculateAllScores` Runs for Same Pool Produce Wrong `total_score`
**Severity:** 🟡 MEDIUM  
**Category:** Correctness / Race Condition  
**Files:**  
- `src/routes/api/admin/results/+server.ts:53`  
- `src/routes/api/predictions/match-scores/+server.ts:103`  
- `src/routes/api/admin/sync-scores/+server.ts:23`

**Description:**  
`calculateAllScores` runs inside a single `BEGIN…COMMIT` transaction, but multiple callers fire it concurrently with `setImmediate`. Under PostgreSQL's default `READ COMMITTED` isolation, if scoring run A has updated `bracket_predictions` but not yet committed, scoring run B begins its `total_score` aggregation (which reads all sub-tables via correlated subqueries). Run B sees the old bracket scores (A's changes aren't committed) but the latest group scores. It then writes an under-counted `total_score`. When run A commits, total_score is now wrong and won't be corrected unless another scoring run fires.

```typescript
// Two of these can run concurrently for the same poolId:
setImmediate(async () => { await calculateAllScores(poolId); });  // from results
setImmediate(async () => { await calculateAllScores(poolId); });  // from match-scores (same pool)
```

**Suggested fix** — serialize scoring per pool with an advisory lock:
```typescript
// In scoring.ts calculateAllScores:
const client = await getClient();
try {
  await client.query('BEGIN');
  // Acquire a per-pool advisory lock (non-blocking variant returns false if already held)
  const { rows: lockRows } = await client.query(
    'SELECT pg_try_advisory_xact_lock($1)', [poolId]
  );
  if (!lockRows[0].pg_try_advisory_xact_lock) {
    // Another scoring run is already in progress for this pool — skip
    await client.query('ROLLBACK');
    return;
  }
  // ... rest of scoring logic
```

---

### WCP-13 — Missing Max-Length Validation for Pool Name and Prediction Label
**Severity:** 🟡 MEDIUM  
**Category:** Security  
**Files:**  
- `src/routes/api/pools/+server.ts:32`  
- `src/routes/api/predictions/entry/+server.ts:9`

**Description:**  
Pool name has a minimum-length check (2 chars) but no maximum. If the DB column is `VARCHAR(255)`, a name of 256+ chars causes a PostgreSQL error and leaks DB error messages through the 500 response. Prediction label has no length validation at all.

```typescript
// pools/+server.ts:32 — missing max
if (!name?.trim() || name.trim().length < 2) return json({ error: '...' }, { status: 400 });
// No upper bound check

// entry/+server.ts:9 — no length check at all
const { pool_id, label = '' } = body;
```

**Suggested fix:**
```typescript
// pools/+server.ts
const trimmed = name?.trim() ?? '';
if (trimmed.length < 2) return json({ error: 'Nombre requerido (mínimo 2 caracteres)' }, { status: 400 });
if (trimmed.length > 100) return json({ error: 'Nombre demasiado largo (máximo 100 caracteres)' }, { status: 400 });

// entry/+server.ts
const labelTrimmed = (label ?? '').trim();
if (labelTrimmed.length > 50) return json({ error: 'Etiqueta demasiado larga (máximo 50 caracteres)' }, { status: 400 });
```

---

### WCP-14 — `DATABASE_URL` Not Validated at Startup
**Severity:** 🟡 MEDIUM  
**Category:** Security / Reliability  
**File:** `src/lib/server/db.ts:4`

**Description:**  
If `DATABASE_URL` is undefined, `new pg.Pool({ connectionString: undefined })` succeeds silently. The first DB query fails at request time with a cryptic connection error. This delays diagnosis — a startup check surfaces misconfigurations immediately.

```typescript
// src/lib/server/db.ts:3 — no guard
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,   // silently undefined if unset
  max: 10
});
```

**Suggested fix:**
```typescript
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required but not set');
}
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
```

---

## LOW Findings

---

### WCP-15 — N+1 Queries in `summary/+page.server.ts`
**Severity:** 🟢 LOW  
**Category:** Performance  
**File:** `src/routes/pool/[id]/summary/+page.server.ts:22–35`

**Description:**  
For each prediction entry the user has, two sequential queries are fired: one for group predictions and one for bracket predictions. For a user with N entries this is 2N+1 round trips. The pattern is already avoided elsewhere (`pool/[id]/+page.server.ts`) using `= ANY($1::int[])`.

```typescript
// summary/+page.server.ts:22-35 — N+1
for (const entry of entries) {
  const { rows: gpRows } = await query(`... WHERE prediction_id = $1`, [entry.id]);
  const { rows: bpRows } = await query(`... WHERE prediction_id = $1`, [entry.id]);
}
```

**Suggested fix:**
```typescript
if (entries.length > 0) {
  const predIds = entries.map(e => e.id);
  const { rows: gpRows } = await query(
    `SELECT prediction_id, group_name, position_1, position_2, position_3, position_4
     FROM group_predictions WHERE prediction_id = ANY($1::int[]) ORDER BY group_name`,
    [predIds]
  );
  const { rows: bpRows } = await query(
    `SELECT prediction_id, phase, slot as match_index, team_id
     FROM bracket_predictions WHERE prediction_id = ANY($1::int[]) ORDER BY phase, slot`,
    [predIds]
  );
  for (const r of gpRows) { if (!groupPreds[r.prediction_id]) groupPreds[r.prediction_id] = []; groupPreds[r.prediction_id].push(r); }
  for (const r of bpRows) { if (!bracketPreds[r.prediction_id]) bracketPreds[r.prediction_id] = []; bracketPreds[r.prediction_id].push(r); }
}
```

---

### WCP-16 — `Pool` TypeScript Interface Field `allow_multiple` Doesn't Match DB Column
**Severity:** 🟢 LOW  
**Category:** Correctness  
**File:** `src/lib/server/types.ts:21`

**Description:**  
`types.ts` declares `allow_multiple: boolean` but the actual database column (used in all queries) is `allow_multiple_predictions`. The type is unused at runtime (queries use `SELECT *` and plain objects), but it creates misleading auto-complete and misaligns with `predict/+page.svelte:9` which correctly accesses `pool.allow_multiple_predictions`.

```typescript
// src/lib/server/types.ts:21 — WRONG name
export interface Pool {
  allow_multiple: boolean;   // DB column is allow_multiple_predictions
  ...
}
```

**Suggested fix:**
```typescript
export interface Pool {
  allow_multiple_predictions: boolean;
  ...
}
```

---

### WCP-17 — In-Process Caches Don't Invalidate Across Server Instances
**Severity:** 🟢 LOW  
**Category:** Security / Performance  
**File:** `src/lib/server/cache.ts` (documented at lines 1–10)

**Description:**  
Session cache, pool leaderboard cache, and global leaderboard cache are all module-level `Map` instances. With any multi-process deployment (Node.js cluster, Railway replicas, Vercel serverless), each instance has an isolated cache. After a score sync or password change, only the instance that handled the request invalidates its own cache. Other instances serve stale sessions or leaderboards for up to 60 s (sessions) / 30 s (leaderboards).

**Note:** This is already acknowledged in the cache module comment. Leaving here for tracking. **Remediation:** migrate to Redis/Upstash for shared invalidation if multi-instance deployment is used.

---

### WCP-18 — Auto-Save Swallows Errors Silently; User Gets No Feedback
**Severity:** 🟢 LOW  
**Category:** Reactivity / UX  
**File:** `src/routes/pool/[id]/predict/+page.svelte:181–203`

**Description:**  
`savePredictions()` catches errors in a `catch` block that only logs to the console. If the server returns `400` or `403` (e.g., deadline passed, session expired) or the network drops, the user sees no error message — the "Guardando..." indicator disappears and nothing else changes. Users may believe their predictions were saved when they were not.

```typescript
// predict/+page.svelte:195-202
const res = await fetch('/api/predictions/group', { ... });
if (res.ok) { saved = true; setTimeout(() => saved = false, 2000); }
// Non-OK response is silently ignored — no error state set
```

**Suggested fix:**
```typescript
let saveError = $state('');

async function savePredictions() {
  saving = true; saved = false; saveError = '';
  try {
    const res = await fetch('/api/predictions/group', { ... });
    if (res.ok) {
      saved = true;
      setTimeout(() => saved = false, 2000);
    } else {
      const d = await res.json().catch(() => ({}));
      saveError = d.error || `Error al guardar (${res.status})`;
    }
  } catch (e) {
    saveError = 'Error de conexión';
  } finally {
    saving = false;
  }
}
```
Then in the template:
```svelte
{#if saveError}
  <span style="font-size: 10px; color: var(--red);">⚠ {saveError}</span>
{/if}
```

---

## Scoring Logic Verification

The three scoring functions were reviewed against the test suite and DEFAULT_RULES:

| Check | Status | Notes |
|-------|--------|-------|
| Correct outcome (1/X/2) → `match_outcome` pts | ✅ Correct | |
| Exact score → `match_outcome` + `exact_score` pts | ✅ Correct | Points are stacked, not exclusive |
| Wrong outcome → 0 pts | ✅ Correct | |
| Group position (per correct slot) → `group_position` pts | ✅ Correct | Only exact-position matches award points |
| Tiebreaker (pts, GD, GF) for group ranking | ✅ Correct | Matches FIFA tiebreaker rules |
| Knockout phase winner → `knockout_{phase}` pts | ✅ Correct | |
| Final winner → `knockout_final` + `knockout_winner` pts | ✅ Correct | 6+8=14 pts for champion |
| 3rd-place match winner → `third_place` pts | ✅ Correct | Uses separate rule key |
| Runner-up in final (bracket slot) → 0 pts | ⚠️ By design | Only winner is in `phaseWinners['final']`; runner-up gets no credit. If intent was to award `knockout_final` to both finalists, this is a bug. |
| Transaction atomicity for `calculateAllScores` | ✅ Correct | Single BEGIN…COMMIT per pool |
| Bulk unnest UPDATE (vs N individual UPDATEs) | ✅ Correct | |
| Scoring rules fetched once before transaction | ✅ Correct | M4 optimization from prior audit |
| Error tracking in pools table on failure | ✅ Correct | `last_score_error` updated in ROLLBACK handler |

**Runner-up note:** `calculateBracketScores` only awards points when `phaseWinners[bp.phase].has(bp.team_id)`. For the `'final'` phase, `phaseWinners['final']` contains only the winning team. The `knockout_final` rule (6 pts) is never awarded to users who correctly picked the runner-up to reach the final. If the intended design is "6 pts for predicting either finalist, +8 bonus for predicting the champion", the scoring function has a logic gap. Confirm with requirements.

---

## Remediation Priority

| Priority | WCP | Effort | Impact |
|----------|-----|--------|--------|
| P0 — Fix immediately | WCP-01 | 1 line | Breaks all group prediction saves |
| P0 — Fix immediately | WCP-02 | 3 lines | Breaks pool page, results page, admin page |
| P1 — Fix this sprint | WCP-03, WCP-04, WCP-05 | < 1h each | Progress bar broken; process crash risk |
| P1 — Fix this sprint | WCP-06, WCP-07, WCP-09 | < 1h each | Wrong HTTP codes; wrong points shown to users; broken payment toggle |
| P2 — Fix before launch | WCP-08, WCP-10, WCP-11, WCP-12, WCP-13, WCP-14 | 2–4h total | Race conditions, rate limiting, validation |
| P3 — Tech debt | WCP-15 through WCP-18 | 1–2h total | Performance and UX polish |
