# World Cup Pool — Implementation Plan for 28 Code Review Findings

## Corrections from Code Review

After re-reading actual code, some review findings needed adjustment:

- **C2 (bracket race):** The bracket endpoint already uses per-slot `ON CONFLICT DO UPDATE` upserts — no DELETE+INSERT pattern. Fix is wrapping the multi-slot upsert loop in a transaction.
- **C4 (race condition):** Sub-endpoints (match/group/bracket) are already idempotent via `ON CONFLICT`. Only `createPrediction` is unprotected.
- **M5+M3:** Must be done together — both restructure `scoring.ts`, highest-risk work.

---

## Phase 1 — Critical (5 fixes, all parallel)

### C1: Per-match deadline enforcement
**Complexity:** Medium | **Files:** `drizzle/migrations/0002_kickoff.sql`, `seed.ts`, `live-scores.ts`, `match-scores/+server.ts`, `group/+server.ts`, `bracket/+server.ts`

**Schema change:**
```sql
ALTER TABLE matches ADD COLUMN kickoff_time TIMESTAMPTZ;
```

**Check before prediction acceptance:**
```typescript
// In each prediction endpoint, before processing:
const { rows: matches } = await query(
  'SELECT id FROM matches WHERE id = ANY($1::int[]) AND kickoff_time <= NOW() + INTERVAL \'5 minutes\'',
  [matchIds]
);
if (matches.length > 0) {
  return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
}
```

**Risky:** Yes — needs data migration for existing match kickoff times. Must populate from FIFA API data.

---

### C2: Bracket prediction transaction
**Complexity:** Small | **Files:** `src/routes/api/predictions/bracket/+server.ts`

```typescript
// Wrap the for-loop of upserts in a transaction:
const client = await getClient();
try {
  await client.query('BEGIN');
  for (const pick of picks) {
    await client.query(
      `INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (prediction_id, phase, slot) DO UPDATE SET team_id = $4`,
      [predictionId, pick.phase, pick.slot, pick.team_id]
    );
  }
  await client.query('COMMIT');
} catch (err) {
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

---

### C3: Session invalidation on password change
**Complexity:** Trivial | **Files:** `src/routes/api/auth/change-password/+server.ts`

```typescript
// After the UPDATE, add:
await query(
  'DELETE FROM sessions WHERE user_id = $1 AND token != $2',
  [locals.user.id, cookies.get('session')]
);
```

---

### C4: ON CONFLICT in createPrediction
**Complexity:** Small | **Files:** `src/lib/server/queries.ts`

```typescript
export async function createPrediction(userId: number, poolId: number, label: string) {
  const { rows } = await query(
    `INSERT INTO predictions (user_id, pool_id, label, total_score)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`
  );
  return rows[0];
}
```

---

### C5: scryptSync → async scrypt
**Complexity:** Medium (cascade) | **Files:** `src/routes/api/auth/[action]/+server.ts`, `src/routes/api/auth/change-password/+server.ts`, `src/lib/server/queries.ts` (if hash helper is here)

```typescript
// Replace:
const hash = crypto.scryptSync(password, salt, 64).toString('hex');

// With:
export async function hashPwd(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPwd(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}
```

All callers become async (they already are from pg migration).

---

## Phase 2 — High Security (5 fixes, all parallel)

### H1: ANY() instead of dynamic placeholders
**Complexity:** Trivial | **Files:** `src/routes/api/predictions/match-scores/+server.ts`, `group/+server.ts`

```typescript
// Replace dynamic $N generation:
const { rows } = await query(
  'SELECT id FROM matches WHERE id = ANY($1::int[]) AND is_active = true',
  [matchIds]
);
```

---

### H2: Pool membership check
**Complexity:** Small | **Files:** `bracket/+server.ts`, `group/+server.ts`, `match-scores/+server.ts`, `tiebreaker/+server.ts`

Create a helper:
```typescript
async function requirePoolMember(userId: number, poolId: number): Promise<boolean> {
  const { rows } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, userId]
  );
  return rows.length > 0;
}
```
Add check at top of each prediction endpoint's POST handler.

---

### H3: Scoring rule whitelist
**Complexity:** Trivial | **Files:** `src/routes/api/admin/scoring/+server.ts`

```typescript
const VALID_RULES = new Set([
  'match_outcome', 'exact_score', 'group_position',
  'knockout_r32', 'knockout_r16', 'knockout_qf', 'knockout_sf',
  'knockout_final', 'knockout_winner', 'third_place',
]);

// Before saving:
for (const rule of Object.keys(rules)) {
  if (!VALID_RULES.has(rule)) {
    return json({ error: `Regla inválida: ${rule}` }, { status: 400 });
  }
}
```

---

### H4: Split getUserByUsername
**Complexity:** Small | **Files:** `src/lib/server/queries.ts`

```typescript
// For auth (includes hash):
export async function getUserForAuth(username: string) {
  const { rows } = await query('SELECT id, username, password_hash, display_name, is_admin FROM users WHERE username = $1', [username]);
  return rows[0] ?? null;
}

// For general use (no hash):
export async function getUserByUsername(username: string) {
  const { rows } = await query('SELECT id, username, display_name, is_admin, created_at FROM users WHERE username = $1', [username]);
  return rows[0] ?? null;
}
```

---

### H5: 401 JSON for API routes
**Complexity:** Trivial | **Files:** `src/hooks.server.ts`

```typescript
if (!event.locals.user) {
  if (event.url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  throw redirect(302, '/login');
}
```

---

## Phase 3 — Medium Performance (8 fixes, ordered)

**Order matters here — do M6 first, then M7, then M4→M5+M3 together, then M1, M2, M8.**

### M6: Missing indexes (do first)
**Complexity:** Trivial | **File:** `drizzle/migrations/0003_indexes.sql`

```sql
CREATE INDEX idx_matches_fifa_id ON matches(fifa_id) WHERE fifa_id IS NOT NULL;
CREATE INDEX idx_pool_members_pool ON pool_members(pool_id);
CREATE INDEX idx_predictions_user ON predictions(user_id);
```

---

### M7: Fire-and-forget cleanSessions
**Complexity:** Trivial | **File:** `src/hooks.server.ts`

```typescript
// Change:
if (now - _lastClean > 60_000) { _lastClean = now; await cleanSessions(); }
// To:
if (now - _lastClean > 60_000) { _lastClean = now; cleanSessions().catch(console.error); }
```

---

### M4→M5→M3: Scoring overhaul (highest risk)
**Complexity:** Large | **Files:** `src/lib/server/scoring.ts`

These three must be done together:
1. **M4:** Fetch rules once in `calculateAllScores`, pass as parameter
2. **M5:** Wrap all 3 phases in a single transaction
3. **M3:** Use `unnest()` for bulk UPDATEs

```typescript
export async function calculateAllScores(poolId: number): Promise<void> {
  // M4: Fetch rules once
  const rules = await getScoringRules(poolId);

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // M3 + M5: All phases in one transaction with bulk updates
    await calculateMatchScores(poolId, rules, client);
    await calculateGroupScores(poolId, rules, client);
    await calculateBracketScores(poolId, rules, client);

    // Update total scores
    await client.query(`
      UPDATE predictions SET total_score = sub.total
      FROM (
        SELECT p.id, COALESCE(SUM(mp.points_earned), 0) + COALESCE(SUM(gp.points_earned), 0) + COALESCE(SUM(bp.points_earned), 0) as total
        FROM predictions p
        LEFT JOIN match_predictions mp ON mp.prediction_id = p.id
        LEFT JOIN group_predictions gp ON gp.prediction_id = p.id
        LEFT JOIN bracket_predictions bp ON bp.prediction_id = p.id
        WHERE p.pool_id = $1
        GROUP BY p.id
      ) sub
      WHERE predictions.id = sub.id
    `, [poolId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Each sub-function takes `client` + `rules` as parameters
// Uses unnest() for bulk updates:
async function calculateMatchScores(poolId: number, rules: Record<string, number>, client: pg.PoolClient) {
  // ... compute points for all rows ...
  const ids: number[] = [];
  const pts: number[] = [];
  for (const mp of allMP) {
    ids.push(mp.id);
    pts.push(computedPoints[mp.id]);
  }
  await client.query(`
    UPDATE match_predictions SET points_earned = v.pts
    FROM unnest($1::int[], $2::int[]) AS v(id, pts)
    WHERE match_predictions.id = v.id
  `, [ids, pts]);
}
```

**Risky:** Highest risk change. Must be tested carefully.

---

### M1: last_scored_at tracking
**Complexity:** Small | **Files:** Schema, `scoring.ts`

```sql
ALTER TABLE pools ADD COLUMN last_scored_at TIMESTAMPTZ;
ALTER TABLE pools ADD COLUMN last_score_error TEXT;
```

In `calculateAllScores`, after COMMIT:
```typescript
await query(
  'UPDATE pools SET last_scored_at = NOW(), last_score_error = NULL WHERE id = $1',
  [poolId]
);
```
In catch:
```typescript
await query(
  'UPDATE pools SET last_score_error = $2 WHERE id = $1',
  [poolId, err.message]
);
```

---

### M2: N+1 batch queries
**Complexity:** Small | **File:** `src/routes/pool/[id]/+page.server.ts`

```typescript
const predIds = predictions.map(p => p.id);
let groupPreds: any[] = [];
let bracketPreds: any[] = [];
if (predIds.length > 0) {
  const { rows: gpRows } = await query(
    'SELECT * FROM group_predictions WHERE prediction_id = ANY($1::int[])', [predIds]
  );
  const { rows: bpRows } = await query(
    'SELECT * FROM bracket_predictions WHERE prediction_id = ANY($1::int[])', [predIds]
  );
  groupPreds = gpRows;
  bracketPreds = bpRows;
}
// Group by prediction_id in JS
```

---

### M8: Document single-instance cache constraint
**Complexity:** Trivial | **File:** `src/lib/server/cache.ts`

Add a comment at the top of the file documenting the constraint.

---

## Phase 4 — Low Quality (10 fixes)

### Phase 4a: Quick wins (all parallel)

**L1:** Fix deadlinePassed to check both deadlines — 1 line change in `pool/[id]/+page.server.ts`
**L2:** Change `third_place` default from 25 to 6 — 2 files (`queries.ts`, `scoring.ts`)
**L5:** Remove unused `pool_id` from results endpoint — 1 line in `admin/results/+server.ts`
**L6:** Standardize all API errors to Spanish — grep and replace across route files
**L10:** Change `allowMultiple` from `0/1` to `false/true` — 2 files (`pools/+server.ts`, `queries.ts`)

### Phase 4b: Larger items (sequential)

**L7:** Add TypeScript row types for top 5 tables — new file `src/lib/server/types.ts`
**L8:** Body size limit on prediction endpoints — 2 lines per endpoint
**L3:** Admin-assisted password reset — new route + query function
**L4:** Audit log table + helper — schema + new file `src/lib/server/audit.ts`
**L9:** Vitest test suite for scoring — new file `src/lib/server/scoring.test.ts`

---

## Execution Order & Dependencies

```
Phase 1 (all parallel):
  C1 ─┐
  C2  ├──→ Build check → Commit
  C3  │
  C4  │
  C5 ─┘

Phase 2 (all parallel):
  H1 ─┐
  H2  ├──→ Build check → Commit
  H3  │
  H4  │
  H5 ─┘

Phase 3 (ordered):
  M6 → M7 → M4+M5+M3 (together, risky) → M1 → M2 → M8 → Build check → Commit

Phase 4a (all parallel):
  L1+L2+L5+L6+L10 → Build check → Commit

Phase 4b (sequential):
  L7 → L8 → L3 → L4 → L9 → Build check → Commit
```

## Risk Assessment

| Fix | Risk | Why |
|---|---|---|
| C1 | Medium | Schema migration + needs kickoff data |
| C2 | Low | Just wraps existing upserts in txn |
| C3 | Low | Simple DELETE |
| C4 | Low | Adds idempotency |
| C5 | Medium | Cascading async changes across auth |
| M4+M5+M3 | **High** | Rewrites core scoring engine |
| L9 | Medium | Test correctness depends on understanding scoring |
| All others | Low | Small targeted changes |

## Estimated Total: 8-14 hours
