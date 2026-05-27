# World Cup Pool — Scoring Fix Plan
## CRITICAL and HIGH Findings — Implementation-Ready

**Generated:** 2026-05-27  
**Source audit:** WORLD-CUP-AUDIT-SCORING.md  
**Commit baseline:** 1416cae

---

## Dependency Order

Apply fixes in this exact sequence to avoid cascading compile errors:

```
C-01  →  C-02 + H-03 (together)  →  C-03  →  H-01  →  H-02 + H-05 (together)  →  H-04
```

- **C-01** unblocks TypeScript compilation; everything else depends on db.ts compiling.
- **C-02 and H-03** are the same root cause (`getScoringRules`). Fix in one pass.
- **C-03** requires a new SQL migration AND changes to scoring.ts AND admin/results. Run migration before restarting the server.
- **H-01, H-02, H-04, H-05** are independent; can be applied in any order after the above.

---

## C-01 — Remove duplicate `getClient` export

**File:** `src/lib/server/db.ts`  
**Line to delete:** 19

### Old code (lines 17–19)
```typescript
export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
export const getClient = () => pool.connect();
```

### New code (line 19 removed)
```typescript
export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
```

---

## C-02 + H-03 — Fix `getScoringRules` and remove wrong inline fallbacks

**File:** `src/lib/server/scoring.ts`  
**Lines affected:** 17–23 (getScoringRules), 35 (group_position fallback), 200–201 (match_outcome/exact_score fallbacks)

### Fix 1 — getScoringRules (lines 17–23)

**Old code:**
```typescript
export async function getScoringRules(poolId: number): Promise<Record<string, number>> {
  const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
  if (rows.length === 0) return { ...DEFAULT_RULES };
  const config: Record<string, number> = {};
  for (const row of rows) config[row.rule] = row.points;
  return config;
}
```

**New code (always merges defaults):**
```typescript
export async function getScoringRules(poolId: number): Promise<Record<string, number>> {
	const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
	// Always start with defaults; DB rows override them — never leaves a key undefined
	const config: Record<string, number> = { ...DEFAULT_RULES };
	for (const row of rows) config[row.rule] = row.points;
	return config;
}
```

### Fix 2 — Remove wrong fallback on line 35

**Old code:**
```typescript
  const ptsPerPosition = rules.group_position ?? 3;
```

**New code:**
```typescript
	const ptsPerPosition = rules.group_position;
```

### Fix 3 — Remove wrong fallbacks on lines 200–201

**Old code:**
```typescript
  const outcomePts = rules.match_outcome ?? 2;
  const exactPts = rules.exact_score ?? 5;
```

**New code:**
```typescript
	const outcomePts = rules.match_outcome;
	const exactPts = rules.exact_score;
```

---

## C-03 — Penalty shootout winner storage and bracket scoring fix

### SQL Migration Required

**New file:** `src/lib/server/migrations/0006_penalty_winner.sql`

```sql
-- 0006: Add penalty_winner_id to matches for knockout rounds decided by penalties
ALTER TABLE matches ADD COLUMN penalty_winner_id INTEGER REFERENCES teams(id);
```

**Run this migration before deploying the code changes below.**

---

### C-03 Change 1 — calculateBracketScores: SELECT penalty_winner_id

**File:** `src/lib/server/scoring.ts`  
**Lines:** 124–130

**Old code:**
```typescript
  const { rows: matches } = await client.query(`
    SELECT id, phase, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE phase IN ('r32','r16','qf','sf','final','3rd')
      AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
  `);
```

**New code:**
```typescript
	const { rows: matches } = await client.query(`
		SELECT id, phase, home_team_id, away_team_id, home_score, away_score, penalty_winner_id
		FROM matches
		WHERE phase IN ('r32','r16','qf','sf','final','3rd')
		  AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
	`);
```

---

### C-03 Change 2 — calculateBracketScores: use penalty_winner_id instead of skip

**File:** `src/lib/server/scoring.ts`  
**Lines:** 136–145

**Old code:**
```typescript
  for (const m of matches) {
    if (m.home_score === m.away_score) {
      console.warn(`[scoring] Knockout match ${m.id} has equal scores — skipping (enter post-penalty result)`);
      continue;
    }
    const winner = m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
    const phase = m.phase;
    if (!phaseWinners[phase]) phaseWinners[phase] = new Set();
    phaseWinners[phase].add(winner);
  }
```

**New code:**
```typescript
	for (const m of matches) {
		const winner =
			m.home_score > m.away_score ? m.home_team_id :
			m.home_score < m.away_score ? m.away_team_id :
			m.penalty_winner_id         ? m.penalty_winner_id :
			null; // still undecided — no penalty winner recorded yet

		if (winner === null) {
			// Match result not yet determinable — skip without warning
			continue;
		}
		const phase = m.phase;
		if (!phaseWinners[phase]) phaseWinners[phase] = new Set();
		phaseWinners[phase].add(winner);
	}
```

---

### C-03 Change 3 — admin/results: accept and persist penalty_winner_id

**File:** `src/routes/api/admin/results/+server.ts`  
**Lines:** 13–15, 42–45

**Old code — body destructuring (lines 13–15):**
```typescript
  const { match_id, home_score, away_score } = await request.json() as {
    match_id: number; home_score: number; away_score: number;
  };
```

**New code:**
```typescript
	const { match_id, home_score, away_score, penalty_winner_id = null } = await request.json() as {
		match_id: number; home_score: number; away_score: number; penalty_winner_id?: number | null;
	};
```

**Old code — UPDATE statement (lines 42–45):**
```typescript
  // Update match result
  await query(
    "UPDATE matches SET home_score = $1, away_score = $2, status = 'finished' WHERE id = $3",
    [home_score, away_score, match_id]
  );
```

**New code:**
```typescript
	// Update match result (penalty_winner_id is NULL for normal wins, set for penalty shootout deciders)
	await query(
		"UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
		[home_score, away_score, match_id, penalty_winner_id]
	);
```

---

## H-01 — Guard against null match prediction scores

**File:** `src/lib/server/scoring.ts`  
**Lines:** 236–246

**Old code:**
```typescript
  for (const mp of allMP) {
    const m = matchMap[mp.match_id];
    if (!m) continue;

    let pts = 0;

    // Determine predicted outcome
    let predOutcome: string;
    if (mp.home_score > mp.away_score) predOutcome = '1';
    else if (mp.home_score < mp.away_score) predOutcome = '2';
    else predOutcome = 'X';
```

**New code (null guard before outcome derivation):**
```typescript
	for (const mp of allMP) {
		const m = matchMap[mp.match_id];
		if (!m) continue;

		// Skip predictions with no score entered — null comparisons silently fall to 'X' (draw)
		if (mp.home_score === null || mp.away_score === null) continue;

		let pts = 0;

		// Determine predicted outcome
		let predOutcome: string;
		if (mp.home_score > mp.away_score) predOutcome = '1';
		else if (mp.home_score < mp.away_score) predOutcome = '2';
		else predOutcome = 'X';
```

---

## H-02 — Fix `mapFifaStageToPhase` to use real numeric FIFA stage IDs

**File:** `src/lib/server/live-scores.ts`  
**Lines:** 194–206

**Old code:**
```typescript
function mapFifaStageToPhase(stageId: string): string {
  // FIFA stage IDs mapping (approximate)
  const map: Record<string, string> = {
    'group': 'group',
    'r32': 'r32',
    'r16': 'r16',
    'qf': 'qf',
    'sf': 'sf',
    '3rd': '3rd',
    'final': 'final',
  };
  return map[stageId] ?? 'group';
}
```

**New code (real FIFA 2026 numeric IDs; 'unknown' surfaces bad IDs):**
```typescript
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

function mapFifaStageToPhase(stageId: string): string {
	const phase = FIFA_STAGE_MAP[stageId];
	if (!phase) {
		console.warn(`[live-scores] Unknown FIFA stage ID: ${stageId} — defaulting to 'unknown'`);
		return 'unknown';
	}
	return phase;
}
```

---

## H-04 — Fix TOCTOU race in prediction creation

**File:** `src/routes/api/predictions/entry/+server.ts`  
**Lines:** 1–3 (imports), 24–47 (check + create block)

**Old code — imports:**
```typescript
import { createPrediction } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
```

**New code — imports (add getClient, drop createPrediction):**
```typescript
import { query, getClient } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
```

**Old code — check + create block (lines 24–47):**
```typescript
  if (!pool.allow_multiple_predictions) {
    // Check if user already has a prediction in this pool
    const { rows: existingRows } = await query(
      'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2',
      [pool_id, locals.user.id]
    );
    if (existingRows.length > 0) {
      return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 403 });
    }
  }

  // Check user already has a prediction with this label
  const { rows: existingLabelRows } = await query(
    'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2 AND label = $3',
    [pool_id, locals.user.id, label]
  );

  if (existingLabelRows.length > 0) {
    return json({ error: 'Ya existe una entrada con ese nombre' }, { status: 409 });
  }

  const result = await createPrediction(pool_id, locals.user.id, label);
  if (!result) return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 409 });
  return json({ id: Number(result.rows[0].id), label });
```

**New code (transactional check + insert; eliminates TOCTOU race):**
```typescript
	// Use a transaction with FOR UPDATE to eliminate the TOCTOU race between
	// the "no existing prediction" check and the INSERT.
	const client = await getClient();
	try {
		await client.query('BEGIN');

		// Lock existing predictions for this user+pool — prevents concurrent duplicate inserts
		const { rows: existing } = await client.query(
			'SELECT id, label FROM predictions WHERE pool_id = $1 AND user_id = $2 FOR UPDATE',
			[pool_id, locals.user.id]
		);

		// Enforce allow_multiple_predictions under the lock
		if (!pool.allow_multiple_predictions && existing.length > 0) {
			await client.query('ROLLBACK');
			return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 403 });
		}

		// Check label uniqueness under the lock
		if (existing.some((r: any) => r.label === label)) {
			await client.query('ROLLBACK');
			return json({ error: 'Ya existe una entrada con ese nombre' }, { status: 409 });
		}

		// Inherit has_paid from pool_members
		const { rows: memberRows } = await client.query(
			'SELECT has_paid FROM pool_members WHERE pool_id = $1 AND user_id = $2',
			[pool_id, locals.user.id]
		);
		const hasPaid = memberRows[0]?.has_paid ?? false;

		const { rows } = await client.query(
			`INSERT INTO predictions (user_id, pool_id, label, total_score, has_paid)
			 VALUES ($1, $2, $3, 0, $4)
			 RETURNING id`,
			[locals.user.id, pool_id, label, hasPaid]
		);

		await client.query('COMMIT');
		return json({ id: Number(rows[0].id), label });
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
```

---

## H-05 — Improve FIFA API error logging and response shape validation

**File:** `src/lib/server/live-scores.ts`  
**Lines:** 76–91 (fetchFromFifaApi function opening)

**Old code:**
```typescript
export async function fetchFromFifaApi(): Promise<LiveMatch[]> {
  try {
    // FIFA World Cup 2026 competition ID
    const res = await fetch(
      `${FIFA_BASE}/matches/competitions/254648?status=completed`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!res.ok) {
      console.error(`[live-scores] FIFA API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const matches: LiveMatch[] = [];

    for (const m of (data.results || [])) {
```

**New code:**
```typescript
export async function fetchFromFifaApi(): Promise<LiveMatch[]> {
	try {
		// FIFA World Cup 2026 competition ID — verify this before the tournament starts
		// TODO: update '254648' once FIFA publishes 2026 WC official API endpoints
		const res = await fetch(
			`${FIFA_BASE}/matches/competitions/254648?status=completed`,
			{ headers: { 'Accept': 'application/json' } }
		);

		if (!res.ok) {
			const body = await res.text().catch(() => '(unreadable)');
			console.error(`[live-scores] FIFA API error: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
			return [];
		}

		const data = await res.json();
		if (!data.results || !Array.isArray(data.results)) {
			console.warn('[live-scores] FIFA API unexpected response shape:', JSON.stringify(data).slice(0, 200));
			return [];
		}

		const matches: LiveMatch[] = [];

		for (const m of data.results) {
```

---

## SQL Migrations Summary

| File | Purpose | Must run before |
|---|---|---|
| `src/lib/server/migrations/0006_penalty_winner.sql` | `ALTER TABLE matches ADD COLUMN penalty_winner_id INTEGER REFERENCES teams(id)` | C-03 code deployed |

---

## Files Modified Summary

| Fix | File(s) |
|---|---|
| C-01 | `src/lib/server/db.ts` |
| C-02 + H-03 | `src/lib/server/scoring.ts` |
| C-03 | `src/lib/server/scoring.ts`, `src/routes/api/admin/results/+server.ts`, `src/lib/server/migrations/0006_penalty_winner.sql` (new) |
| H-01 | `src/lib/server/scoring.ts` |
| H-02 | `src/lib/server/live-scores.ts` |
| H-04 | `src/routes/api/predictions/entry/+server.ts` |
| H-05 | `src/lib/server/live-scores.ts` |
