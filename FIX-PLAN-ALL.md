# Mundial 2026 — Fix Plan for AUDIT-FULL-OPUS.md

This plan covers all 35 findings (CRITICAL → LOW). Each fix lists the exact file,
line numbers, current ("old") code, new code, dependencies, and any SQL.

Dependency graph (high-level):
- §1.1 must precede §2.7 (visual layout audit depends on wired indices).
- §1.1 must precede §3.13 (R32 3rd-place picker UI touches the same component).
- §2.5 should precede §2.4 (penalty winner validation is independent of name
  matching but improves the safety of admin overrides used to fix a missed sync).
- §3.3 (deterministic ORDER BY in `getUserPredictions`) should precede
  §3.11 (members query refactor) — both touch `queries.ts`.
- All other fixes are independent and may be applied in any order, though the
  recommended priority order from the audit §9 is:
  1. §1.1 → 2. §1.2 → 3. §2.5 → 4. §2.2 → 5. §2.1 → 6. §3.13 → 7. remainder.

No SQL **migration** is strictly required (no schema changes), but §2.4 strongly
recommends an `ALTER TABLE teams ADD COLUMN fifa_aliases TEXT[]` migration.
That SQL is listed in §2.4 below.

---

## §1.1 — Bracket wiring: R32_TO_R16, R16_LABELS, QF_LABELS (CRITICAL)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`
**Lines:** 35–36 (R32_TO_R16), 45–50 (R16_LABELS), 51 (QF_LABELS).

### Old code (lines 35–51):
```js
  // R32 → R16 feed-in: R16[i] = winner of R32[R32_TO_R16[i*2]] vs R32[R32_TO_R16[i*2+1]]
  const R32_TO_R16 = [0, 1, 2, 4, 3, 5, 6, 7, 10, 11, 9, 8, 13, 15, 14, 12];

  // Match labels
  const R32_LABELS = [
    '1E vs 3rd(A/B/C/D/F)', '1I vs 3rd(C/D/F/G/H)', '2A vs 2B', '1F vs 2C',
    '2K vs 2L', '1H vs 2J', '1D vs 3rd(B/E/F/I/J)', '1G vs 3rd(A/E/H/I/J)',
    '1C vs 2F', '2E vs 2I', '1A vs 3rd(C/E/F/H/I)', '1L vs 3rd(E/H/I/J/K)',
    '1J vs 2H', '2D vs 2G', '1B vs 3rd(E/F/G/I/J)', '1K vs 3rd(D/E/I/J/L)',
  ];
  const R16_LABELS = [
    'W(R32-1) vs W(R32-2)', 'W(R32-3) vs W(R32-5)',
    'W(R32-4) vs W(R32-6)', 'W(R32-7) vs W(R32-8)',
    'W(R32-11) vs W(R32-12)', 'W(R32-10) vs W(R32-9)',
    'W(R32-14) vs W(R32-16)', 'W(R32-15) vs W(R32-13)',
  ];
  const QF_LABELS = ['W(R16-0) vs W(R16-1)', 'W(R16-4) vs W(R16-5)', 'W(R16-2) vs W(R16-3)', 'W(R16-6) vs W(R16-7)'];
```

### New code:
```js
  // R32 → R16 feed-in: R16[i] = winner of R32[R32_TO_R16[i*2]] vs R32[R32_TO_R16[i*2+1]]
  // App index → FIFA match number:
  //   0:M75 1:M76 2:M81 3:M79 4:M82 5:M80 6:M83 7:M84
  //   8:M85 9:M87 10:M73 11:M74 12:M86 13:M88 14:M77 15:M78
  // FIFA R16 pairings (adjacent FIFA matches): 73+74, 75+76, 77+78, 79+80,
  //   81+82, 83+84, 85+86, 87+88
  // → app index pairs:
  //   (10,11)=M89, (0,1)=M90, (14,15)=M91, (3,5)=M92,
  //   (2,4)=M93, (6,7)=M94, (8,12)=M95, (9,13)=M96
  const R32_TO_R16 = [
     0, 1,    // R16[0] = M90 (left wing)
     2, 4,    // R16[1] = M93 (left wing)
     3, 5,    // R16[2] = M92 (left wing)
     6, 7,    // R16[3] = M94 (left wing)
    10, 11,   // R16[4] = M89 (right wing)
     8, 12,   // R16[5] = M95 (right wing)  ← fixed (was 9, 8)
     9, 13,   // R16[6] = M96 (right wing)  ← fixed (was 13, 15)
    14, 15,   // R16[7] = M91 (right wing)  ← fixed (was 14, 12)
  ];

  // Match labels
  const R32_LABELS = [
    '1E vs 3rd(A/B/C/D/F)', '1I vs 3rd(C/D/F/G/H)', '2A vs 2B', '1F vs 2C',
    '2K vs 2L', '1H vs 2J', '1D vs 3rd(B/E/F/I/J)', '1G vs 3rd(A/E/H/I/J)',
    '1C vs 2F', '2E vs 2I', '1A vs 3rd(C/E/F/H/I)', '1L vs 3rd(E/H/I/J/K)',
    '1J vs 2H', '2D vs 2G', '1B vs 3rd(E/F/G/I/J)', '1K vs 3rd(D/E/I/J/L)',
  ];
  const R16_LABELS = [
    'W(R32-1) vs W(R32-2)',   // M90
    'W(R32-3) vs W(R32-5)',   // M93
    'W(R32-4) vs W(R32-6)',   // M92
    'W(R32-7) vs W(R32-8)',   // M94
    'W(R32-11) vs W(R32-12)', // M89
    'W(R32-9) vs W(R32-13)',  // M95  ← fixed (was 'W(R32-10) vs W(R32-9)')
    'W(R32-10) vs W(R32-14)', // M96  ← fixed (was 'W(R32-14) vs W(R32-16)')
    'W(R32-15) vs W(R32-16)', // M91  ← fixed (was 'W(R32-15) vs W(R32-13)')
  ];
  // FIFA QFs: M97=M89+M90, M98=M91+M92, M99=M93+M94, M100=M95+M96
  //   → R16-index pairs (using new order above): (4,0), (7,2), (1,3), (5,6)
  const QF_LABELS = [
    'W(R16-5) vs W(R16-1)',   // M97 (R16[4] + R16[0])
    'W(R16-8) vs W(R16-3)',   // M98 (R16[7] + R16[2])
    'W(R16-2) vs W(R16-4)',   // M99 (R16[1] + R16[3])
    'W(R16-6) vs W(R16-7)',   // M100 (R16[5] + R16[6])
  ];
```

> **Important second step:** the QF cascade in `recascade()` (line 263 onwards)
> pairs R16 indices `(0,1)`, `(2,3)`, `(4,5)`, `(6,7)` into QF. To make the new
> QF semantics actually take effect we must change the way QF is fed from R16.
> The simplest cosmetic-only fix (no scoring change) is to keep the cascade and
> only relabel — labels above already do that. The proper logic fix is to add an
> explicit `R16_TO_QF` mapping:

Additional change inside `recascade()` (lines 262–280): replace the generic
`i*2 + j` index walk for the `r16 → qf` cascade with an explicit map. The full
patch for the cascade block follows:

### Old code (lines 262–280):
```js
    // Cascade: R16 → QF → SF → Final (sequential pairs)
    const cascades = [
      { from: 'r16', to: 'qf' },
      { from: 'qf', to: 'sf' },
      { from: 'sf', to: 'final' },
    ];
    for (const { from, to } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          const winner = getWinner(from, i * 2 + j);
          // Invalidate explicit pick if the team is no longer available
          if (_picks[to][i][j] && _teams[to][i][j] !== winner) {
            _picks[to][i][0] = false;
            _picks[to][i][1] = false;
          }
          _teams[to][i][j] = _picks[to][i][j] ? _teams[to][i][j] : winner;
        }
      }
    }
```

### New code:
```js
    // Cascade: R16 → QF uses an explicit FIFA-correct mapping;
    // QF → SF and SF → Final remain sequential pair-of-two.
    const R16_TO_QF = [4, 0, 7, 2, 1, 3, 5, 6]; // QF[i] = (R16[R16_TO_QF[i*2]], R16[R16_TO_QF[i*2+1]])
    for (let i = 0; i < _teams.qf.length; i++) {
      for (let j = 0; j < 2; j++) {
        const winner = getWinner('r16', R16_TO_QF[i * 2 + j]);
        if (_picks.qf[i][j] && _teams.qf[i][j] !== winner) {
          _picks.qf[i][0] = false;
          _picks.qf[i][1] = false;
        }
        _teams.qf[i][j] = _picks.qf[i][j] ? _teams.qf[i][j] : winner;
      }
    }
    const cascades = [
      { from: 'qf', to: 'sf' },
      { from: 'sf', to: 'final' },
    ];
    for (const { from, to } of cascades) {
      for (let i = 0; i < _teams[to].length; i++) {
        for (let j = 0; j < 2; j++) {
          const winner = getWinner(from, i * 2 + j);
          if (_picks[to][i][j] && _teams[to][i][j] !== winner) {
            _picks[to][i][0] = false;
            _picks[to][i][1] = false;
          }
          _teams[to][i][j] = _picks[to][i][j] ? _teams[to][i][j] : winner;
        }
      }
    }
```

**Dependency:** §2.7 (visual layout audit) must be re-validated after this fix;
the cascade-map change makes the right-wing visual blocks (slices in the
desktop layout) cohere only after both edits are applied.

---

## §1.2 — IDOR: enforce pool membership on `pool/[id]` server loads (CRITICAL)

Add membership gate to every server load that reads pool-scoped data.

### A) `src/routes/pool/[id]/+page.server.ts`

#### Old code (lines 7–15):
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const members = await getPoolMembers(poolId);
  const leaderboard = await getPoolLeaderboard(poolId);
  const scoring = await getScoringConfig(poolId);
  const predictions = locals.user ? await getUserPredictions(poolId, locals.user.id) : [];
```

#### New code:
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  if (!locals.user) throw error(401, 'Inicia sesión');
  const { rows: m } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (m.length === 0 && (pool as any).created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  const members = await getPoolMembers(poolId);
  const leaderboard = await getPoolLeaderboard(poolId);
  const scoring = await getScoringConfig(poolId);
  const predictions = await getUserPredictions(poolId, locals.user.id);
```

### B) `src/routes/pool/[id]/predict/+page.server.ts`

#### Old code (lines 6–13):
```ts
export const load: ServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const teams = await getAllTeams() as any[];
```

#### New code:
```ts
export const load: ServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  const { rows: m } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (m.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  const teams = await getAllTeams() as any[];
```

### C) `src/routes/pool/[id]/bracket/+page.server.ts`

#### Old code (lines 6–11):
```ts
export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');
```

#### New code:
```ts
export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }
```

### D) `src/routes/pool/[id]/results/+page.server.ts`

#### Old code (lines 6–10):
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');
```

#### New code:
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  if (!locals.user) throw error(401, 'Inicia sesión');
  const { rows: m } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (m.length === 0 && (pool as any).created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }
```

### E) `src/routes/pool/[id]/summary/+page.server.ts`

#### Old code (lines 7–12):
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  if (!locals.user) return { pool, entries: [], groupPreds: {}, bracketPreds: {}, teams: {} };
```

#### New code:
```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  if (!locals.user) throw error(401, 'Inicia sesión');

  // Membership gate (IDOR §1.2)
  const { rows: m } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (m.length === 0 && (pool as any).created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }
```

**SQL:** none. **Dependency:** independent.

---

## §1.3 — Cache coherence: enforce single-instance constraint (CRITICAL)

**File:** `src/lib/server/cache.ts` — add a runtime assertion at module load that
fails fast if `PROCESS_INSTANCE_INDEX` (or equivalent) implies horizontal scale.

### Old code (lines 1–13):
```ts
/**
 * In-memory TTL cache for session, teams, and pool results.
 *
 * ⚠️ CONSTRAINT: All state is module-level (per-process).
 * This works for single-server deployment but will NOT work
 * with horizontal scaling (Vercel serverless, Railway replicas, etc.)
 * — each instance has an isolated cache. After a score sync,
 * only the instance that handled the request invalidates its cache.
 * Other instances serve stale data until TTL expires.
 * If horizontal scaling is needed, migrate to Redis.
 */

import { query } from './db.js';
```

### New code:
```ts
/**
 * In-memory TTL cache for session, teams, and pool results.
 *
 * ⚠️ HARD CONSTRAINT: All state is module-level (per-process). This is only
 * safe with a SINGLE Node instance. With multiple replicas a logout/password
 * change/score sync executes on one instance only — every other instance keeps
 * serving stale data (and stale auth!) until its local TTL expires.
 *
 * If you need horizontal scale, migrate session + leaderboard caches to Redis
 * (or Postgres LISTEN/NOTIFY) before bumping replica count above 1.
 */

import { query } from './db.js';

// §1.3 — boot-time assertion: refuse to start if env hints at multi-instance.
// Recognises common platform indicators: Vercel (VERCEL=1), Railway replica
// count, Fly machines, Kubernetes pod replicas. Override with
// ALLOW_MULTI_INSTANCE_CACHE=1 (only after migrating caches to a shared store).
(() => {
  if (process.env.ALLOW_MULTI_INSTANCE_CACHE === '1') return;
  const multiHints: { name: string; value: string | undefined }[] = [
    { name: 'VERCEL', value: process.env.VERCEL },
    { name: 'RAILWAY_REPLICA_COUNT', value: process.env.RAILWAY_REPLICA_COUNT },
    { name: 'FLY_APP_REPLICAS', value: process.env.FLY_APP_REPLICAS },
    { name: 'K8S_REPLICAS', value: process.env.K8S_REPLICAS },
  ];
  for (const h of multiHints) {
    if (h.value && h.value !== '' && h.value !== '0' && h.value !== '1') {
      throw new Error(
        `[cache] Refusing to boot: ${h.name}=${h.value} indicates >1 instance ` +
        `but caches are in-process. Set ALLOW_MULTI_INSTANCE_CACHE=1 only ` +
        `after migrating session/leaderboard caches to Redis (see cache.ts).`
      );
    }
    if (h.name === 'VERCEL' && h.value === '1') {
      // Vercel is serverless by default — every cold start has an empty cache.
      console.warn('[cache] Running on Vercel; per-invocation caches are cold. ' +
                   'Consider migrating to Redis for shared state.');
    }
  }
})();
```

**Dependency:** independent. **SQL:** none.

---

## §2.1 — Rate-limit `change-password` (HIGH)

**File:** `src/lib/server/rate-limit.ts` — add a new exported helper.

### Append to end of file (after line 47):
```ts
// §2.1 — change-password rate limit, keyed on userId.
// 5 attempts / 15 minutes is enough to thwart brute force without locking out a
// user who genuinely forgot their current password.
const _authLimits = new Map<number, { count: number; resetAt: number }>();
const AUTH_LIMIT = 5;
const AUTH_WINDOW = 15 * 60 * 1000;

export function checkAuthRate(userId: number): boolean {
  const now = Date.now();
  // Piggy-back on the existing eviction cadence to keep the map bounded.
  if (_authLimits.size > 10_000) {
    for (const [k, v] of _authLimits) if (now > v.resetAt) _authLimits.delete(k);
  }
  const e = _authLimits.get(userId);
  if (!e || now > e.resetAt) {
    _authLimits.set(userId, { count: 1, resetAt: now + AUTH_WINDOW });
    return true;
  }
  if (e.count >= AUTH_LIMIT) return false;
  e.count++;
  return true;
}
```

**File:** `src/routes/api/auth/change-password/+server.ts`

### Old code (lines 1–6):
```ts
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
```

### New code:
```ts
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  if (!checkAuthRate(locals.user.id)) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }
```

**Dependency:** independent. **SQL:** none.

---

## §2.2 — `leaderboard` ORDER BY non-aggregated `tc.closeness` (HIGH)

**File:** `src/routes/leaderboard/+page.server.ts` — change `tc.closeness` to
`MIN(tc.closeness) ASC NULLS LAST` in the ORDER BY clause.

### Old code (lines 73):
```sql
    ORDER BY total_score DESC, exact_score_hits DESC, total_correct DESC, tc.closeness ASC
```

### New code:
```sql
    ORDER BY total_score DESC,
             exact_score_hits DESC,
             total_correct DESC,
             MIN(tc.closeness) ASC NULLS LAST
```

The full replacement block (lines 72–75) becomes:
```sql
    GROUP BY u.id
    ORDER BY total_score DESC,
             exact_score_hits DESC,
             total_correct DESC,
             MIN(tc.closeness) ASC NULLS LAST
    LIMIT 100
```

**Dependency:** independent. **SQL:** none.

---

## §2.3 — `kickoff_time IS NULL` fallback to pool deadline (HIGH)

**File:** `src/routes/api/predictions/bracket/+server.ts`

### Old code (lines 88–108):
```ts
  // Check deadline
  const { rows: poolRows } = await query('SELECT deadline_knockout FROM pools WHERE id = $1', [pred.pool_id]);
  const poolCheck = poolRows[0] ?? null;
  if (poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= new Date()) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // B5-2: Per-phase kickoff deadline — only filter out started phases, don't block entire save
  const phases = Object.keys(picks);
  if (phases.length > 0) {
    const { rows: startedRows } = await query(
      `SELECT DISTINCT phase FROM matches
       WHERE phase = ANY($1::text[])
         AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()`,
      [phases]
    );
    const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
    for (const p of startedPhaseSet) {
      delete (picks as Record<string, unknown>)[p];
    }
  }
```

### New code:
```ts
  // Check deadline
  const { rows: poolRows } = await query('SELECT deadline_knockout FROM pools WHERE id = $1', [pred.pool_id]);
  const poolCheck = poolRows[0] ?? null;
  const knockoutDeadlinePassed =
    !!poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= new Date();
  if (knockoutDeadlinePassed) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // §2.3 — Per-phase kickoff deadline. A phase is "started" if ANY match has
  // already kicked off (kickoff_time IS NOT NULL AND kickoff_time <= NOW()).
  // If a knockout match has no kickoff_time (NULL), the pool-level
  // deadline_knockout already gates the whole knockout phase above, so we
  // do NOT silently allow that phase through.
  const phases = Object.keys(picks);
  if (phases.length > 0) {
    const { rows: startedRows } = await query(
      `SELECT DISTINCT phase FROM matches
       WHERE phase = ANY($1::text[])
         AND (
           (kickoff_time IS NOT NULL AND kickoff_time <= NOW())
           -- §2.3: if the row has no kickoff_time, treat it as gated by the
           -- pool-level deadline, which we already enforced above. If we got
           -- here, that deadline has NOT passed, so this branch contributes
           -- nothing. We list it explicitly so the intent is documented.
         )`,
      [phases]
    );
    const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
    for (const p of startedPhaseSet) {
      delete (picks as Record<string, unknown>)[p];
    }
  }
```

> Equivalent fix (audit's preferred wording): change the WHERE clause to
> `WHERE phase = ANY($1::text[]) AND COALESCE(kickoff_time, $2::timestamptz) <= NOW()`
> and bind `$2` to the pool's `deadline_knockout`. Use whichever variant the
> implementer prefers; both produce the same observable behaviour.

**Dependency:** independent. **SQL:** none.

Apply the same pattern to `src/routes/api/predictions/group/+server.ts` lines
96–112 if group-stage matches ever have NULL `kickoff_time`.

---

## §2.4 — `live-scores.ts` fuzzy team-name match (HIGH)

**File:** `src/lib/server/live-scores.ts`

### Required SQL migration (run before code change):

```sql
-- Alias table (preferred): one row per (team_id, fifa_alias).
CREATE TABLE IF NOT EXISTS team_aliases (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias_normalized TEXT NOT NULL,
  PRIMARY KEY (team_id, alias_normalized)
);
CREATE INDEX IF NOT EXISTS idx_team_aliases_alias ON team_aliases (alias_normalized);

-- Seed known FIFA / API-Football names for the 48 teams that already exist:
INSERT INTO team_aliases (team_id, alias_normalized) VALUES
  ((SELECT id FROM teams WHERE name = 'South Korea'),         'korea republic'),
  ((SELECT id FROM teams WHERE name = 'South Korea'),         'republic of korea'),
  ((SELECT id FROM teams WHERE name = 'United States'),       'usa'),
  ((SELECT id FROM teams WHERE name = 'United States'),       'united states of america'),
  ((SELECT id FROM teams WHERE name = 'Ivory Coast'),         "cote d'ivoire"),
  ((SELECT id FROM teams WHERE name = 'Czech Republic'),      'czechia'),
  ((SELECT id FROM teams WHERE name = 'Bosnia and Herzegovina'), 'bosnia'),
  ((SELECT id FROM teams WHERE name = 'Bosnia and Herzegovina'), 'bosnia-herzegovina'),
  ((SELECT id FROM teams WHERE name = 'Cape Verde'),          'cabo verde'),
  ((SELECT id FROM teams WHERE name = 'DR Congo'),            'dr congo'),
  ((SELECT id FROM teams WHERE name = 'DR Congo'),            'democratic republic of congo'),
  ((SELECT id FROM teams WHERE name = 'North Macedonia'),     'macedonia'),
  ((SELECT id FROM teams WHERE name = 'Curaçao'),             'curacao'),
  ((SELECT id FROM teams WHERE name = 'Saudi Arabia'),        'ksa'),
  ((SELECT id FROM teams WHERE name = 'New Zealand'),         'aotearoa')
ON CONFLICT DO NOTHING;
```

### Old code (lines 149–162):
```ts
    if (!dbMatch) {
      // Try matching by team names (fuzzy)
      // Escape LIKE wildcards % and _ in team names to prevent injection
      const escapeLike = (s: string) => s.replace(/[%_]/g, '\\$&');
      const res = await query(`
        SELECT m.* FROM matches m
        JOIN teams t1 ON t1.id = m.home_team_id
        JOIN teams t2 ON t2.id = m.away_team_id
        WHERE (t1.name LIKE $1 ESCAPE '\\' AND t2.name LIKE $2 ESCAPE '\\')
          AND m.status != 'finished'
        LIMIT 1
      `, [`%${escapeLike(m.home_team)}%`, `%${escapeLike(m.away_team)}%`]);
      dbMatch = res.rows[0] ?? null;
    }
```

### New code:
```ts
    if (!dbMatch) {
      // §2.4 — Resolve API team names through teams.name AND team_aliases,
      // using a normalized form (lower + strip diacritics + collapse spaces).
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[̀-ͯ]/g, '')
         .toLowerCase().trim().replace(/\s+/g, ' ');
      const homeN = norm(m.home_team);
      const awayN = norm(m.away_team);

      const res = await query(
        `
        WITH resolver AS (
          SELECT id, lower(name) AS canon FROM teams
          UNION ALL
          SELECT team_id AS id, alias_normalized AS canon FROM team_aliases
        )
        SELECT m.*
        FROM matches m
        JOIN resolver rh ON rh.id = m.home_team_id AND rh.canon = $1
        JOIN resolver ra ON ra.id = m.away_team_id AND ra.canon = $2
        WHERE m.status != 'finished'
        LIMIT 1
        `,
        [homeN, awayN]
      );
      dbMatch = res.rows[0] ?? null;

      if (!dbMatch) {
        console.warn(
          `[live-scores] No DB match for "${m.home_team}" (norm "${homeN}") ` +
          `vs "${m.away_team}" (norm "${awayN}") — consider adding an alias.`
        );
      }
    }
```

**Dependency:** the alias-table migration must run before the code is deployed.
Otherwise the resolver CTE references a non-existent table.

---

## §2.5 — Admin `penalty_winner_id` bounds check (HIGH)

**File:** `src/routes/api/admin/results/+server.ts`

### Old code (lines 38–46):
```ts
    // Get match
    const { rows: matchRows } = await query('SELECT * FROM matches WHERE id = $1', [match_id]);
    const match = matchRows[0] ?? null;
    if (!match) return json({ error: 'Partido no encontrado' }, { status: 404 });

    // Update match result (penalty_winner_id is NULL for normal wins, set for penalty shootout deciders)
    await query(
      "UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
      [home_score, away_score, match_id, penalty_winner_id]
    );
```

### New code:
```ts
    // Get match
    const { rows: matchRows } = await query('SELECT * FROM matches WHERE id = $1', [match_id]);
    const match = matchRows[0] ?? null;
    if (!match) return json({ error: 'Partido no encontrado' }, { status: 404 });

    // §2.5 — Validate penalty_winner_id:
    //   - only allowed when the match ends in a draw,
    //   - must equal one of the two teams.
    if (penalty_winner_id !== null) {
      if (home_score !== away_score) {
        return json({ error: 'penalty_winner sólo en empates' }, { status: 400 });
      }
      if (
        penalty_winner_id !== match.home_team_id &&
        penalty_winner_id !== match.away_team_id
      ) {
        return json({ error: 'penalty_winner_id no coincide con los equipos del partido' }, { status: 400 });
      }
    }

    // Update match result (penalty_winner_id is NULL for normal wins, set for penalty shootout deciders)
    await query(
      "UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
      [home_score, away_score, match_id, penalty_winner_id]
    );
```

**Dependency:** independent. **SQL:** none.

---

## §2.6 — `B5-3` cross-phase consistency: hydrate from DB (HIGH)

**File:** `src/routes/api/predictions/bracket/+server.ts`

### Old code (lines 139–170):
```ts
  // B5-3: Cross-phase consistency check.
  // Any team picked in a later phase must also appear in the immediately preceding phase.
  const PHASE_PROGRESSION: Record<string, string> = {
    r16: 'r32',
    qf: 'r16',
    sf: 'qf',
    final: 'sf',
    '3rd': 'sf',
  };

  for (const [phase, slots] of Object.entries(picks)) {
    const precedingPhase = PHASE_PROGRESSION[phase];
    if (!precedingPhase) continue;

    const teamsInThisPhase = new Set(
      Object.values(slots).filter((id): id is number => id !== null)
    );
    const precedingPicks = picks[precedingPhase] ?? {};
    const teamsInPrecedingPhase = new Set(
      Object.values(precedingPicks).filter((id): id is number => id !== null)
    );

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

### New code:
```ts
  // B5-3: Cross-phase consistency check.
  // Any team picked in a later phase must also appear in the immediately preceding phase.
  const PHASE_PROGRESSION: Record<string, string> = {
    r16: 'r32',
    qf: 'r16',
    sf: 'qf',
    final: 'sf',
    '3rd': 'sf',
  };

  // §2.6 — When the client doesn't re-send the preceding phase, hydrate it
  // from the DB so the consistency rule still applies. (The bracket page
  // autosave posts every phase, but external callers and a future entry UI
  // could omit it.)
  const precedingCache: Record<string, Set<number>> = {};
  async function getPrecedingTeams(precedingPhase: string): Promise<Set<number>> {
    if (precedingCache[precedingPhase]) return precedingCache[precedingPhase];
    const inBody = picks[precedingPhase];
    if (inBody) {
      precedingCache[precedingPhase] = new Set(
        Object.values(inBody).filter((id): id is number => id !== null)
      );
      return precedingCache[precedingPhase];
    }
    const { rows } = await query(
      'SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = $2 AND team_id IS NOT NULL',
      [prediction_id, precedingPhase]
    );
    precedingCache[precedingPhase] = new Set(rows.map((r: any) => r.team_id as number));
    return precedingCache[precedingPhase];
  }

  for (const [phase, slots] of Object.entries(picks)) {
    const precedingPhase = PHASE_PROGRESSION[phase];
    if (!precedingPhase) continue;

    const teamsInThisPhase = new Set(
      Object.values(slots).filter((id): id is number => id !== null)
    );
    const teamsInPrecedingPhase = await getPrecedingTeams(precedingPhase);

    // If we still have no preceding-phase data (truly empty), skip the check
    // — there's nothing to validate against and we don't want to block a
    // legitimate first-time save of just the final.
    if (teamsInPrecedingPhase.size === 0) continue;

    for (const teamId of teamsInThisPhase) {
      if (!teamsInPrecedingPhase.has(teamId)) {
        return json({
          error: `Equipo ${teamId} no fue seleccionado en la fase previa (${precedingPhase})`,
        }, { status: 400 });
      }
    }
  }
```

**Dependency:** independent. **SQL:** none.

---

## §2.7 — Visual layout vs wiring re-validation (HIGH)

**File:** `src/routes/pool/[id]/bracket/+page.svelte` (desktop layout lines
649–865; the relevant blocks are 685–700, 703–719, 815–830, 793–810).

After §1.1's `R32_TO_R16` and `R16_TO_QF` are applied, the desktop layout's
left/right wing slices must continue to draw R16/QF cards whose feeders live on
the same wing.

The current slicing — `(teams.r16 || []).slice(0, 4)` for left, `slice(4, 8)`
for right, `(teams.qf || []).slice(0, 2)` for left, `slice(2, 4)` for right —
matches the new mapping by construction (R16[0..3] are fed by R32[0..7] which
sit on the left; R16[4..7] are fed by R32[8..15] which sit on the right; QF[0]
mixes R16[4] left-wing-feeder with R16[0] left-wing — wait — QF[0] in the new
mapping pairs R16[4] (right wing) with R16[0] (left wing): that **crosses
wings**, which is correct for QF since QF games are where the two halves of the
bracket merge into the SFs).

**Action:** no code change is strictly required for the desktop slicing
constants. But the QF column header on the left wing currently shows QF-1/QF-2
which under the new mapping pull from `R16[4]+R16[0]` and `R16[7]+R16[2]`. The
visual labels `QF-{mi + 1}` (lines 716, 807) are fine. The reviewer should run
through the bracket once after §1.1 lands and verify by hand:

- Left wing R16 cards (`R16[0..3]`) feed from R32 cards on the left wing
  (R32 indices 0..7).
- Right wing R16 cards (`R16[4..7]`) feed from R32 cards on the right wing
  (R32 indices 8..15).
- Left wing QF cards (`QF[0..1]`) display the **winner labels** for the new
  R16 pairings: `R16-5 vs R16-1` and `R16-8 vs R16-3` — these straddle wings,
  which is expected for QF.

If the team prefers a layout where QF cards live above their feeding wing, that
is a layout-only refactor and out of scope for this fix plan (no underlying
data is wrong). Recommendation: add a Cypress / Playwright visual snapshot test
after §1.1 lands.

**Dependency:** **MUST** be done after §1.1. **SQL:** none.

---

## §3.1 — Session cleanup throttle moved outside if/else (MEDIUM)

**File:** `src/hooks.server.ts`

### Old code (lines 29–36):
```ts
    if (user) {
      event.locals.user = user;
    } else {
      const now = Date.now();
      if (now - _lastClean > 60_000) { _lastClean = now; cleanSessions().catch(console.error); }
	}
  }
```

### New code:
```ts
    if (user) {
      event.locals.user = user;
    }
  }

  // §3.1 — Run cleanSessions at most once per minute, regardless of cache
  // hit/miss. Previously gated on "no user found", which means a healthy
  // request stream never cleans up expired sessions.
  const now = Date.now();
  if (now - _lastClean > 60_000) {
    _lastClean = now;
    cleanSessions().catch(console.error);
  }
```

**Dependency:** independent. **SQL:** none.

---

## §3.2 — Document `pool/[id]` cache key safety (MEDIUM, doc-only)

**File:** `src/routes/pool/[id]/+page.server.ts`

### Old code (lines 123–128):
```ts
  // F-20: Cache results data (phases, team cache, group standings)
  let resultsPhases: Record<string, any[]>;
  let resultsTeamCache: Record<number, any>;
  let resultsGroupStandings: Record<string, any[]>;

  const cachedResults = getCachedPoolResults(pool.id);
```

### New code (just adds a comment — no behaviour change):
```ts
  // F-20: Cache results data (phases, team cache, group standings).
  // §3.2 — IMPORTANT: this cache key is `pool.id` only and the cached object
  // currently contains tournament-wide data (no user-specific fields). DO NOT
  // add user-scoped fields here — they would be served to every member of the
  // pool. If user-specific data ever belongs here, change the cache key to
  // `${pool.id}:${userId}`.
  let resultsPhases: Record<string, any[]>;
  let resultsTeamCache: Record<number, any>;
  let resultsGroupStandings: Record<string, any[]>;

  const cachedResults = getCachedPoolResults(pool.id);
```

**Dependency:** independent. **SQL:** none.

---

## §3.3 — Deterministic ORDER BY in `getUserPredictions` (MEDIUM)

**File:** `src/lib/server/queries.ts`

### Old code (lines 189–192):
```ts
export async function getUserPredictions(poolId: number, userId: number): Promise<Prediction[]> {
  const { rows } = await query('SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
  return rows as Prediction[];
}
```

### New code:
```ts
export async function getUserPredictions(poolId: number, userId: number): Promise<Prediction[]> {
  // §3.3 — Sort by creation time so callers that use predictions[0] as the
  // "default entry" always get the same row across requests.
  const { rows } = await query(
    'SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC',
    [poolId, userId]
  );
  return rows as Prediction[];
}
```

**Dependency:** must precede §3.11 (both edit `queries.ts`). **SQL:** none.

---

## §3.4 — Origin/Referer whitelist on mutation endpoints (MEDIUM)

**File:** `src/hooks.server.ts` — add an Origin check for state-changing
methods on `/api/*` routes.

### Old code (lines 9–11):
```ts
export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;
```

### New code:
```ts
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('session');
  const path = event.url.pathname;

  // §3.4 — Defence-in-depth: reject cross-origin state-changing API requests.
  // sameSite=lax already blocks the cookie cross-site, but if that policy is
  // ever relaxed (e.g. for an OAuth flow), this guards the JSON endpoints.
  if (path.startsWith('/api/') && STATE_CHANGING.has(event.request.method)) {
    const origin = event.request.headers.get('origin');
    if (origin) {
      const expected = event.url.origin;
      if (origin !== expected) {
        return new Response(JSON.stringify({ error: 'Origin no permitido' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    // If origin is null (e.g. same-origin form submit, server-to-server),
    // SvelteKit's built-in CSRF still applies to form actions; JSON endpoints
    // are protected by sameSite cookies. We deliberately don't require Origin.
  }
```

**Dependency:** independent. **SQL:** none.

---

## §3.5 — Group position monotonicity (MEDIUM)

**File:** `src/routes/api/predictions/group/+server.ts`

### Old code (lines 121–128):
```ts
  // Validate no duplicate teams within a group, and skip groups with no positions filled
  for (const [groupName, positions] of Object.entries(groups)) {
    const filled = [positions.pos1, positions.pos2, positions.pos3, positions.pos4].filter(v => v != null);
    const unique = new Set(filled);
    if (filled.length !== unique.size) {
      return json({ error: `Duplicate team in Group ${groupName}` }, { status: 400 });
    }
  }
```

### New code:
```ts
  // Validate no duplicate teams within a group, and skip groups with no positions filled
  for (const [groupName, positions] of Object.entries(groups)) {
    const ordered = [positions.pos1, positions.pos2, positions.pos3, positions.pos4];
    const filled = ordered.filter(v => v != null);
    const unique = new Set(filled);
    if (filled.length !== unique.size) {
      return json({ error: `Duplicate team in Group ${groupName}` }, { status: 400 });
    }

    // §3.5 — No gaps: if posN is set, every position before it must also be set.
    let seenNull = false;
    for (const p of ordered) {
      if (p == null) seenNull = true;
      else if (seenNull) {
        return json(
          { error: `Posiciones con huecos en Grupo ${groupName} (rellena las posiciones anteriores primero)` },
          { status: 400 }
        );
      }
    }
  }
```

**Dependency:** independent. **SQL:** none.

---

## §3.6 — match-scores: synchronous re-score on edit (MEDIUM)

**File:** `src/routes/api/predictions/match-scores/+server.ts`

### Old code (lines 133–146):
```ts
  // Async scoring — respond immediately, score in background
  const poolId = pred.pool_id;
  setImmediate(async () => {
    try {
      await calculateAllScores(poolId);
      invalidateCachedPoolLeaderboard(poolId);
      invalidateCachedPoolResults(poolId);
      invalidateGlobalLeaderboard();
    } catch (e) {
      console.error('[bg-score] match-scores pool', poolId, e);
    }
  });

  return json({ ok: true });
};
```

### New code:
```ts
  // §3.6 — Score synchronously when the user edits a prediction whose previous
  // points_earned was non-zero. The ON CONFLICT clause above sets points_earned
  // to 0 on update, so the UI would otherwise show a stale total until the
  // setImmediate callback finishes. Doing it inline keeps the displayed total
  // in lockstep with the just-zeroed row.
  const poolId = pred.pool_id;
  try {
    await calculateAllScores(poolId);
    invalidateCachedPoolLeaderboard(poolId);
    invalidateCachedPoolResults(poolId);
    invalidateGlobalLeaderboard();
  } catch (e) {
    console.error('[score] match-scores pool', poolId, e);
    // Fall through — we already saved the prediction; the next sync will
    // reconcile points_earned. Surface the error code, not a generic 500.
    return json({ ok: true, scoring: 'failed' });
  }

  return json({ ok: true });
};
```

**Dependency:** independent. **SQL:** none.

---

## §3.7 — `admin/sync-scores` worker pool + is_active recheck (MEDIUM)

**File:** `src/routes/api/admin/sync-scores/+server.ts`

### Old code (lines 1–43):
```ts
import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

// POST /api/admin/sync-scores
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Only global admins can sync live scores
  if (!locals.user.is_admin) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    const result = await syncScores();

    // Async rescoring after sync
    if (result.updated > 0) {
      const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
      const poolIds = pools.map((p: any) => p.id);
      setImmediate(async () => {
        for (const poolId of poolIds) {
          try {
            await calculateAllScores(poolId);
            invalidateCachedPoolLeaderboard(poolId);
            invalidateCachedPoolResults(poolId);
          } catch (e) {
            console.error(`[bg-score] sync-scores pool ${poolId}:`, e);
          }
        }
        invalidateGlobalLeaderboard();
      });
    }

    return json({ ok: true, ...result });
  } catch (e) {
    console.error('[api/admin/sync-scores] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
```

### New code:
```ts
import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

const SCORE_CONCURRENCY = 3;

// §3.7 — Bounded-concurrency worker pool. Caps in-flight calculateAllScores
// calls so two concurrent syncs don't pile up dozens of contenders for the
// per-pool advisory lock.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    runners.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        try { await worker(item); } catch (e) { console.error('[worker]', e); }
      }
    })());
  }
  await Promise.all(runners);
}

// POST /api/admin/sync-scores
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  if (!locals.user.is_admin) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    const result = await syncScores();

    if (result.updated > 0) {
      const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
      const poolIds = pools.map((p: any) => p.id);

      setImmediate(async () => {
        await runWithConcurrency(poolIds, SCORE_CONCURRENCY, async (poolId) => {
          // §3.7 — Re-check is_active before each scoring pass: the pool may
          // have been disabled or deleted while the previous batch was running.
          const { rows: stillActive } = await query(
            'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
            [poolId]
          );
          if (stillActive.length === 0) return;

          try {
            await calculateAllScores(poolId);
            invalidateCachedPoolLeaderboard(poolId);
            invalidateCachedPoolResults(poolId);
          } catch (e) {
            console.error(`[bg-score] sync-scores pool ${poolId}:`, e);
          }
        });
        invalidateGlobalLeaderboard();
      });
    }

    return json({ ok: true, ...result });
  } catch (e) {
    console.error('[api/admin/sync-scores] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
```

Apply the same `runWithConcurrency` + is_active recheck pattern to
`src/routes/api/admin/results/+server.ts` lines 54–65.

**Dependency:** independent. **SQL:** none.

---

## §3.8 — Bracket page: avoid double-cloning state on every change (MEDIUM)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (lines 204–227):
```js
  // Derive display state reactively based on version
  const teams = $derived.by(() => {
    void version;
    const t = {};
    for (const [k, v] of Object.entries(_teams)) {
      if (Array.isArray(v)) {
        t[k] = v.map(m => Array.isArray(m) ? [m[0], m[1]] : m);
      } else {
        t[k] = v;
      }
    }
    return t;
  });
  const explicitPicks = $derived.by(() => {
    void version;
    const p = {};
    for (const [k, v] of Object.entries(_picks)) {
      if (Array.isArray(v)) {
        p[k] = v.map(row => Array.isArray(row) ? [row[0], row[1]] : row);
      } else {
        p[k] = v;
      }
    }
    return p;
  });
```

### New code:
```js
  // §3.8 — Direct reactive proxies (no per-bump deep clone). The version
  // counter still forces re-evaluation; we just stop allocating O(matches*2)
  // arrays on every click. The downside vs. the deep clone is that nested
  // mutations of `_teams` after the derived runs are visible immediately, but
  // every mutation site already calls `bump()`, so the trade-off is safe.
  const teams = $derived.by(() => {
    void version;
    return _teams;
  });
  const explicitPicks = $derived.by(() => {
    void version;
    return _picks;
  });
```

> Caveat: commit `bf3e846` added the deep clone specifically to fix a visual
> cascade lag. If reverting it brings the lag back, the deeper fix is to
> migrate `_teams` / `_picks` to `$state.raw` and trigger explicit
> re-assignment on each mutation. That is a larger refactor; this minimal
> patch is a starting point and should be benchmarked on mobile before
> shipping.

**Dependency:** independent. **SQL:** none.

---

## §3.9 — Tiebreaker UI: distinguish update vs delete (MEDIUM)

**File A:** `src/routes/api/predictions/tiebreaker/+server.ts`

### Old code (lines 80–91):
```ts
    // Upsert
    if (home_score !== null && away_score !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, home_score, away_score]);
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
    }

    return json({ ok: true });
```

### New code:
```ts
    // §3.9 — Surface whether we saved or deleted so the UI can show the right
    // confirmation toast.
    let action: 'saved' | 'deleted';
    if (home_score !== null && away_score !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, home_score, away_score]);
      action = 'saved';
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
      action = 'deleted';
    }

    return json({ ok: true, action });
```

**File B:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (lines 358–373):
```js
  async function saveTiebreaker() {
    if (!data.selectedId) return;
    const h = tieHome !== null && tieHome !== '' ? Number(tieHome) : null;
    const a = tieAway !== null && tieAway !== '' ? Number(tieAway) : null;
    if (h === null || a === null || isNaN(h) || isNaN(a)) return;
    tieSaving = true; tieSaved = false;
    try {
      const r = await fetch('/api/predictions/tiebreaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, home_score: h, away_score: a }),
      });
      if (r.ok) { showToast('✓ Guardado'); }
    } catch {}
    tieSaving = false;
  }
```

### New code:
```js
  async function saveTiebreaker() {
    if (!data.selectedId) return;
    const h = tieHome !== null && tieHome !== '' ? Number(tieHome) : null;
    const a = tieAway !== null && tieAway !== '' ? Number(tieAway) : null;
    // §3.9 — Allow saving when both are null (treat as explicit clear); the
    // server will delete the row in that case. Previously this early-returned
    // and left a stale value in the DB.
    if ((h !== null && (isNaN(h) || h === null)) ||
        (a !== null && (isNaN(a) || a === null))) return;
    tieSaving = true; tieSaved = false;
    try {
      const r = await fetch('/api/predictions/tiebreaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prediction_id: data.selectedId, home_score: h, away_score: a }),
      });
      if (r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.action === 'deleted') showToast('✓ Borrado');
        else showToast('✓ Guardado');
      }
    } catch {}
    tieSaving = false;
  }
```

**Dependency:** independent. **SQL:** none.

---

## §3.10 — Seed FIFA ranks may shift before tournament (MEDIUM, doc)

**File:** `src/lib/server/seed.ts` — add an explicit "last refreshed" comment;
optionally add a `/api/admin/refresh-ranks` endpoint (out of scope here).

### Old code (lines 3–5):
```ts
// 48 confirmed qualified teams for FIFA World Cup 2026 (April 2026)
// Groups based on December 2025 draw results from Wikipedia
const teams = [
```

### New code:
```ts
// 48 confirmed qualified teams for FIFA World Cup 2026.
// Groups based on December 5, 2025 FIFA draw.
//
// §3.10 — Ranks last verified: 2026-04. FIFA publishes ranking refreshes
// monthly; values here may differ from the official pre-tournament ranking.
// Two teams currently share rank 48 (Ivory Coast, Qatar) — this is a known
// duplicate, not a typo. Refresh before kickoff by re-running
// `npm run seed` (the script is idempotent: it upserts by team name).
const teams = [
```

**Dependency:** independent. **SQL:** none.

---

## §3.11 — `getPoolMembers` returns cartesian on multi-entry pools (MEDIUM)

**File:** `src/lib/server/queries.ts` — split into two functions and update the
admin page server to use the new shape.

### Old code (lines 156–172):
```ts
export async function getPoolMembers(poolId: number) {
  // Return all pool members + their prediction entries (one row per entry if exists)
  // Members without predictions still show (just no entry_id)
  const { rows } = await query(
    `SELECT u.id as user_id, u.username, u.display_name,
      pr.id as entry_id, pr.label as entry_label, pr.total_score,
      COALESCE(pr.has_paid, pm.has_paid, FALSE) as has_paid,
      pm.joined_at
    FROM pool_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN predictions pr ON pr.pool_id = pm.pool_id AND pr.user_id = pm.user_id
    WHERE pm.pool_id = $1
    ORDER BY u.display_name, pr.created_at`,
    [poolId]
  );
  return rows;
}
```

### New code:
```ts
// §3.11 — DISTINCT one row per member (used for "how many members in the
// pool" counts). For per-entry data (e.g. the admin list of paid/unpaid
// entries), call getPoolEntries() instead.
export async function getPoolMembers(poolId: number) {
  const { rows } = await query(
    `SELECT u.id as user_id, u.username, u.display_name,
      pm.has_paid, pm.joined_at
     FROM pool_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.pool_id = $1
     ORDER BY u.display_name`,
    [poolId]
  );
  return rows;
}

// §3.11 — One row per (member, prediction entry). Members with no entries are
// still listed (entry_id is NULL).
export async function getPoolEntries(poolId: number) {
  const { rows } = await query(
    `SELECT u.id as user_id, u.username, u.display_name,
      pr.id as entry_id, pr.label as entry_label, pr.total_score,
      COALESCE(pr.has_paid, pm.has_paid, FALSE) as has_paid,
      pm.joined_at
     FROM pool_members pm
     JOIN users u ON u.id = pm.user_id
     LEFT JOIN predictions pr ON pr.pool_id = pm.pool_id AND pr.user_id = pm.user_id
     WHERE pm.pool_id = $1
     ORDER BY u.display_name, pr.created_at`,
    [poolId]
  );
  return rows;
}
```

**File:** `src/routes/pool/[id]/admin/+page.server.ts`

### Old code (lines 17, 36–42):
```ts
  const members = await getPoolMembers(poolId);
  const scoring = await getScoringConfig(poolId);
  ...
  const stats = {
    totalMembers: members.length,
    totalPaid: (members as any[]).filter(m => m.has_paid).length,
    totalPredictions: tpRows[0].c,
    totalMatches: tmRows[0].c,
    finishedMatches: fmRows[0].c,
  };
```

### New code:
```ts
  const { getPoolEntries } = await import('$lib/server/queries.js');
  const members = await getPoolMembers(poolId);   // one row per user
  const entries = await getPoolEntries(poolId);   // one row per (user, entry)
  const scoring = await getScoringConfig(poolId);
  ...
  const stats = {
    totalMembers: members.length,                 // §3.11 — true member count
    totalEntries: entries.length,                 // §3.11 — entry count
    totalPaid: (members as any[]).filter(m => m.has_paid).length,
    totalPredictions: tpRows[0].c,
    totalMatches: tmRows[0].c,
    finishedMatches: fmRows[0].c,
  };
```

Also return `entries` from the load so the admin page can iterate per-entry:
```ts
  return { pool, members, entries, scoring, matches, stats };
```

And update `src/routes/pool/[id]/+page.server.ts` line 12 if it depended on the
old per-entry rows from `getPoolMembers`. Inspect the consumer in
`pool/[id]/+page.svelte` and `pool/[id]/admin/+page.svelte` before deploying.

**Dependency:** must follow §3.3 (both edit `queries.ts`). **SQL:** none.

---

## §3.12 — Invite code entropy (MEDIUM)

**File:** `src/lib/server/queries.ts`

### Old code (lines 27–29):
```ts
// Generate unique invite codes
export function generateInviteCode(): string {
  return crypto.randomBytes(16).toString('base64url').slice(0, 16).toUpperCase();
}
```

### New code:
```ts
// §3.12 — base64url-uppercase collapses the 64-char alphabet to ~38 distinct
// characters (digits + uppercase letters + '-' '_'). 16 chars at ~38 distinct
// values is ~84 bits — fine today but at the low end. Bump the length to 24
// (≈ 126 bits after the uppercase squashing) so codes survive any future
// public-facing enumeration scan.
export function generateInviteCode(): string {
  return crypto.randomBytes(24).toString('base64url').slice(0, 24).toUpperCase();
}
```

**SQL:** check the `pools.invite_code` column's max length. If it's `VARCHAR(16)`,
run `ALTER TABLE pools ALTER COLUMN invite_code TYPE VARCHAR(32);` first.

**Dependency:** schema check before code change (if applicable).

---

## §3.13 — R32 3rd-place picker writes "winner", not "slot" (MEDIUM)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (lines 103–122):
```js
  function pick3rd(mi, teamId) {
    haptic(8);
    const match = _teams.r32[mi];
    const current = match[1]; // currently picked team (or null)
    animatePick('r32', mi, 1);
    const exp = _picks.r32[mi];
    if (current === teamId) {
      // Undo pick
      exp[1] = false;
      match[1] = null;
    } else {
      // Set pick
      exp[1] = true;
      match[1] = teamId;
    }
    recascade();
    bump();
    autoSaveBracket();
    closeThirdSelector();
  }
```

### New code:
```js
  // §3.13 — Track which 3rd-place team OCCUPIES slot 1 of a wildcard R32 match
  // independently from who WINS that match. Without this split, choosing the
  // 3rd-place team would also auto-promote them as the match winner.
  let _thirdSlots = {}; // { [mi]: teamId } — wildcard occupant only

  function pick3rd(mi, teamId) {
    haptic(8);
    animatePick('r32', mi, 1);
    const currentSlot = _thirdSlots[mi] ?? null;
    if (currentSlot === teamId) {
      // Undo slot selection — and any winner pick that referenced it.
      _thirdSlots[mi] = null;
      _teams.r32[mi][1] = null;
      // If the user had picked the 3rd team as the winner, clear that too.
      if (_picks.r32[mi]?.[1]) {
        _picks.r32[mi][1] = false;
      }
    } else {
      _thirdSlots[mi] = teamId;
      _teams.r32[mi][1] = teamId;
      // Setting the occupant does NOT mark them as the winner.
      _picks.r32[mi][1] = false;
    }
    recascade();
    bump();
    autoSaveBracket();
    closeThirdSelector();
  }
```

Also update `initState` (lines 164–201) to rehydrate `_thirdSlots` from the
existing bracket: if the R32 match `m.t2g === '?'` and the DB has a team in
slot `i*2+2`, push that team into `_thirdSlots[i]` instead of (or in addition
to) `_picks.r32[i][1]`. The exact two-line addition inside the existing R32
init loop (around line 177–183):

### Old code:
```js
    for (let i = 0; i < 32; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.r32?.[slot]) {
        t.r32[mi][ti] = data.existingBracket.r32[slot];
        exp.r32[mi][ti] = true;
      }
    }
```

### New code:
```js
    for (let i = 0; i < 32; i++) {
      const slot = i + 1, mi = Math.floor(i / 2), ti = i % 2;
      if (data.existingBracket?.r32?.[slot]) {
        t.r32[mi][ti] = data.existingBracket.r32[slot];
        // §3.13 — For wildcard R32 matches, the team in slot ti=1 represents
        // the chosen 3rd-place occupant. Restore the occupant map; only mark
        // it as a "winner" pick if the user also predicted them to advance,
        // which we cannot infer from this single field. Default: occupant only.
        if (ti === 1 && R32_MAP[mi].t2g === '?') {
          _thirdSlots = _thirdSlots ?? {};
          _thirdSlots[mi] = data.existingBracket.r32[slot];
        } else {
          exp.r32[mi][ti] = true;
        }
      }
    }
```

> Note: this changes the persistence semantics for the wildcard slot. The
> server currently treats any non-null team in `r32` as an explicit pick. To
> match the new semantics, persist `_thirdSlots` to a separate column or
> phase (e.g. `phase = 'r32_slot'`) — see schema follow-up below.

**Optional SQL (recommended once the UX split lands):**
```sql
-- §3.13 — Allow recording the occupant of an R32 wildcard slot separately
-- from a winner prediction.
ALTER TABLE bracket_predictions
  ADD COLUMN IF NOT EXISTS is_winner_pick BOOLEAN NOT NULL DEFAULT TRUE;
-- Existing rows: every persisted row was a winner pick → default TRUE is correct.
```

The `bracket/+server.ts` save endpoint and `scoring.ts` would then need to
filter on `is_winner_pick = TRUE` when counting winners. That broader change
is out of scope for this audit fix; the minimal patch above closes the UX
double-pick by maintaining the split client-side and continuing to write the
team into r32 slot 1 (server-side semantics unchanged).

**Dependency:** independent. **SQL:** optional (recommended).

---

## §4.1 — Bracket legend ambiguity (LOW)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (line 993):
```html
    <span class="legend-item"><span class="legend-tbd">TBD</span> Clasificados de 3er puesto</span>
```

### New code:
```html
    <span class="legend-item"><span class="legend-tbd">TBD</span> Clasificados (3er puesto o grupo sin predecir)</span>
```

**Dependency:** independent.

---

## §4.2 — `animatePick`: race-tap clobbers `origBg` (LOW)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (lines 305–315):
```js
  function animatePick(phase, matchIdx, teamIdx) {
    const btn = document.getElementById(`btn-${phase}-${matchIdx}-${teamIdx}`);
    if (!btn) return;
    btn.classList.add('team-pick');
    const origBg = btn.style.background;
    btn.style.background = 'rgba(201,168,76,0.15)';
    setTimeout(() => {
      btn.classList.remove('team-pick');
      btn.style.background = origBg;
    }, 200);
  }
```

### New code:
```js
  function animatePick(phase, matchIdx, teamIdx) {
    const btn = document.getElementById(`btn-${phase}-${matchIdx}-${teamIdx}`);
    if (!btn) return;
    // §4.2 — Cancel any prior animation for this button so rapid taps don't
    // overwrite origBg and leave the inline override stuck.
    const prev = btn.dataset.animTimer;
    if (prev) clearTimeout(Number(prev));
    if (!btn.dataset.origBg) btn.dataset.origBg = btn.style.background || '';
    btn.classList.add('team-pick');
    btn.style.background = 'rgba(201,168,76,0.15)';
    const tid = setTimeout(() => {
      btn.classList.remove('team-pick');
      btn.style.background = btn.dataset.origBg || '';
      delete btn.dataset.origBg;
      delete btn.dataset.animTimer;
    }, 200);
    btn.dataset.animTimer = String(tid);
  }
```

**Dependency:** independent.

---

## §4.3 — `flagEmoji` silently white-flags unknown codes (LOW)

**File:** `src/routes/pool/[id]/bracket/+page.svelte`

### Old code (lines 506–512):
```js
  function flagEmoji(code) {
    if (!code) return '';
    if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (code.length !== 2) return '🏳️';
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + 127397)).join('');
  }
```

### New code:
```js
  function flagEmoji(code) {
    if (!code) return '';
    if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
    if (code.length !== 2) {
      // §4.3 — Surface unknown codes during dev so we add tags as new teams
      // qualify, instead of silently rendering 🏳️.
      if (typeof console !== 'undefined' && code.length > 0) {
        console.warn('[flagEmoji] unknown flag code:', code);
      }
      return '🏳️';
    }
    return code.toUpperCase().split('').map(c => String.fromCodePoint(c.codePointAt(0) + 127397)).join('');
  }
```

**Dependency:** independent.

---

## §4.4 — `getUserPools` ordering (LOW)

**File:** `src/lib/server/queries.ts`

### Old code (lines 129–140):
```ts
export async function getUserPools(userId: number) {
  const { rows } = await query(
    `SELECT p.*, pm.has_paid, pm.joined_at,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id
    WHERE pm.user_id = $1
    ORDER BY p.created_at DESC`,
    [userId]
  );
  return rows;
}
```

### New code:
```ts
export async function getUserPools(userId: number) {
  // §4.4 — Order by most-recent-joined so a user who joins many pools sees the
  // newest one at the top, regardless of when that pool was originally created.
  const { rows } = await query(
    `SELECT p.*, pm.has_paid, pm.joined_at,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id
    WHERE pm.user_id = $1
    ORDER BY pm.joined_at DESC, p.created_at DESC`,
    [userId]
  );
  return rows;
}
```

**Dependency:** independent.

---

## §4.5 — `publicPaths` doc-string drift (LOW)

**File:** `src/hooks.server.ts`

### Old code (line 6):
```ts
const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join', '/s/', '/api/health'];
```

### New code:
```ts
// §4.5 — `/api/auth` matches /api/auth/login, /register, /logout
// AND /api/auth/change-password. The change-password handler self-guards
// (it requires `locals.user` and would return 401), so this is not a
// security hole — just a documentation note. If a future route under
// /api/auth/* assumes the publicPaths prefix means "unauthenticated", add
// an explicit auth check.
const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join', '/s/', '/api/health'];
```

**Dependency:** independent.

---

## §4.6 — Pool admin: allow site-admin in addition to creator (LOW)

**File:** `src/routes/pool/[id]/admin/+page.server.ts`

### Old code (lines 13–15):
```ts
  if (pool.created_by !== locals.user.id) {
    throw error(403, 'Solo el creador puede acceder al admin');
  }
```

### New code:
```ts
  // §4.6 — Match /api/admin/payment behaviour: creator OR site admin.
  if (pool.created_by !== locals.user.id && !locals.user.is_admin) {
    throw error(403, 'Solo el creador o un administrador del sitio pueden acceder');
  }
```

**Dependency:** independent.

---

## §4.7 — Verify FIFA stage IDs (LOW, doc)

**File:** `src/lib/server/live-scores.ts`

### Old code (lines 201–210):
```ts
// FIFA World Cup 2026 numeric stage IDs — verify against live API before tournament starts
const FIFA_STAGE_MAP: Record<string, string> = {
	'285063': 'group',  // Group Stage
	'285064': 'r32',    // Round of 32
	'285065': 'r16',    // Round of 16
	'285066': 'qf',     // Quarter-finals
	'285067': 'sf',     // Semi-finals
	'285068': '3rd',    // Third Place
	'285069': 'final',  // Final
};
```

### New code:
```ts
// §4.7 — FIFA World Cup 2026 numeric stage IDs. The IDs below are STUBS placed
// during scaffolding and were never confirmed against a live FIFA API
// response. Before the tournament kicks off:
//   1. Hit `${FIFA_BASE}/competitions/{competitionId}/stages` from a one-off
//      script (or use the live response from `${FIFA_BASE}/matches/...`).
//   2. Replace each value below with the real `idStage`.
//   3. Add a unit test that pins these IDs.
const FIFA_STAGE_MAP: Record<string, string> = {
	'285063': 'group',  // Group Stage    — STUB
	'285064': 'r32',    // Round of 32    — STUB
	'285065': 'r16',    // Round of 16    — STUB
	'285066': 'qf',     // Quarter-finals — STUB
	'285067': 'sf',     // Semi-finals    — STUB
	'285068': '3rd',    // Third Place    — STUB
	'285069': 'final',  // Final          — STUB
};
```

**Dependency:** independent.

---

## §4.8 — Audit log silent failure (LOW)

**File:** `src/lib/server/audit.ts`

### Old code (lines 3–8):
```ts
export async function logAudit(action: string, userId: number, entity: string, entityId: number | null, oldValue: any = null, newValue: any = null) {
  await query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, action, entity, entityId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(err => console.error('[audit] Failed to log:', err));
}
```

### New code:
```ts
// §4.8 — In-process counter of audit-log failures so ops can alert on it.
// Read via /api/health (out of scope to plumb here, but the counter is
// exported for any future endpoint that wants to surface it).
export const auditFailureCount = { value: 0 };

export async function logAudit(action: string, userId: number, entity: string, entityId: number | null, oldValue: any = null, newValue: any = null) {
  await query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, action, entity, entityId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(err => {
    auditFailureCount.value++;
    console.error('[audit] Failed to log:', err);
  });
}
```

**Dependency:** independent.

---

## §4.9 — DB pool `application_name` (LOW)

**File:** `src/lib/server/db.ts`

### Old code (lines 5–20):
```ts
export function getPool(): pg.Pool {
	if (!_pool) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL environment variable is required but not set');
		_pool = new pg.Pool({
			connectionString: url,
			max: 10,
			// H-05: Production-safe defaults for remote Postgres
			ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
		});
		_pool.on('error', (err) => console.error('[db] Idle client error:', err.message));
	}
	return _pool;
}
```

### New code:
```ts
export function getPool(): pg.Pool {
	if (!_pool) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL environment variable is required but not set');
		_pool = new pg.Pool({
			connectionString: url,
			max: 10,
			ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
			// §4.9 — Set application_name so DBA dashboards (pg_stat_activity)
			// can identify this app's connections.
			application_name: process.env.PG_APPLICATION_NAME || 'mundial2026',
		});
		_pool.on('error', (err) => console.error('[db] Idle client error:', err.message));
	}
	return _pool;
}
```

**Dependency:** independent.

---

## §4.10 — Seed script lacks explicit `process.exit(0)` (LOW)

**File:** `src/lib/server/seed.ts`

### Old code (lines 123–126):
```ts
seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

### New code:
```ts
// §4.10 — Be explicit about both success and failure exit codes so CI/CD
// reliably distinguishes them.
seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
```

**Dependency:** independent.

---

## §4.11 — `tiebreaker_close = 9999` default placement (LOW)

**File:** `src/routes/pool/[id]/+page.server.ts`

### Old code (lines 96–103):
```ts
    let tiebreakerClose = 9999;
    if (finalMatch) {
      const tb = tiebreakerMap[predId];
      if (tb?.home_score != null && tb?.away_score != null) {
        tiebreakerClose = Math.abs(tb.home_score - finalMatch.home_score) + Math.abs(tb.away_score - finalMatch.away_score);
      }
    }
```

### New code:
```ts
    // §4.11 — When no tiebreaker exists, leave it `null` (sorted last via the
    // sort below). 9999 placed entries-without-tiebreakers ABOVE entries with a
    // very bad tiebreaker, which is not the desired order.
    let tiebreakerClose: number | null = null;
    if (finalMatch) {
      const tb = tiebreakerMap[predId];
      if (tb?.home_score != null && tb?.away_score != null) {
        tiebreakerClose = Math.abs(tb.home_score - finalMatch.home_score) + Math.abs(tb.away_score - finalMatch.away_score);
      }
    }
```

Also update the sort on lines 116–121 to treat `null` as "worst":

### Old code (lines 116–121):
```ts
  enrichedLeaderboard.sort((a: any, b: any) =>
    b.total_score - a.total_score ||
    b.total_correct - a.total_correct ||
    a.tiebreaker_close - b.tiebreaker_close ||
    new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
  );
```

### New code:
```ts
  enrichedLeaderboard.sort((a: any, b: any) => {
    if (b.total_score !== a.total_score) return b.total_score - a.total_score;
    if (b.total_correct !== a.total_correct) return b.total_correct - a.total_correct;
    // §4.11 — null tiebreaker_close sorts after any numeric value.
    const at = a.tiebreaker_close ?? Number.POSITIVE_INFINITY;
    const bt = b.tiebreaker_close ?? Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  });
```

**Dependency:** independent.

---

## §4.12 — Error codes on 5xx responses (LOW)

**File:** every endpoint that returns `{ error: 'Internal server error' }`.
Affected files (representative list — apply the same pattern to each):
- `src/routes/api/auth/change-password/+server.ts:25`
- `src/routes/api/predictions/bracket/+server.ts:39, 195`
- `src/routes/api/predictions/group/+server.ts:41`
- `src/routes/api/predictions/tiebreaker/+server.ts:23, 93`
- `src/routes/api/admin/results/+server.ts:70`
- `src/routes/api/admin/sync-scores/+server.ts:41`

### Pattern — old code:
```ts
  } catch (e) {
    console.error('[api/...] error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
```

### Pattern — new code:
```ts
  } catch (e) {
    const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    console.error(`[api/...] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
```

Apply at each `catch` location listed above. Keep the `console.error` prefix
(`[api/admin/results]`, etc.) so log greps still work.

**Dependency:** independent.

---

## Summary of dependencies

- **§1.1 → §2.7**: layout audit needs the corrected wiring numbers.
- **§1.1 → §3.13**: same component, ensure these patches don't conflict.
- **§3.3 → §3.11**: both edit `queries.ts`; sequence to avoid merge conflicts.
- **§2.4 schema migration → §2.4 code**: alias table must exist before the new
  CTE references it.
- All other findings are independent and can be applied in any order.

Recommended deployment sequence (matches audit §9):
1. §1.1 — bracket wiring.
2. §1.2 — IDOR membership gates.
3. §2.5 — penalty_winner_id validation.
4. §2.2 — leaderboard ORDER BY.
5. §2.1 — change-password rate limit.
6. §3.13 — R32 3rd-place split.
7. §1.3 — single-instance assertion (or move caches to Redis first).
8. §2.4 — alias table + code.
9. §2.3, §2.6, §2.7 — bracket save robustness + visual audit.
10. Remaining MEDIUMs (§3.x).
11. Remaining LOWs (§4.x).
