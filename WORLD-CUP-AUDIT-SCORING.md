# World Cup Pool — Live Scoring System Audit Report

**Date:** 2026-05-27  
**Auditor:** Claude Sonnet 4.6  
**Scope:** Live scoring correctness, FIFA API sync, cache invalidation, concurrency, data integrity, and API safety  
**Branch:** master (`1416cae`)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Findings](#critical-findings)
3. [High Severity Findings](#high-severity-findings)
4. [Medium Severity Findings](#medium-severity-findings)
5. [Low Severity Findings](#low-severity-findings)
6. [Summary Table](#summary-table)

---

## Executive Summary

The live scoring system is architecturally sound — the bulk `unnest()` UPDATE pattern, single-transaction scoring, and async fire-and-forget rescoring after match edits are all good design choices. However, **three critical bugs** will produce incorrect scores or fail to compile in production, and several high-severity issues undermine correctness and FIFA data-feed reliability. The most impactful findings are:

- A **duplicate export** in `db.ts` that is a TypeScript compilation error
- **Scoring rule inline fallbacks** that are inconsistent with `DEFAULT_RULES`, producing wrong point values whenever a pool has a partial scoring config
- **No penalty shootout winner storage**, meaning any knockout match decided by penalties silently awards zero bracket points
- **`mapFifaStageToPhase` always returns `'group'`** because FIFA returns numeric stage IDs, not the string keys the map expects

---

## Critical Findings

---

### C-01 — Duplicate `getClient` export prevents compilation

| Field | Value |
|---|---|
| **Severity** | Critical |
| **File** | `src/lib/server/db.ts` |
| **Lines** | 18–19 |
| **Category** | Build error / availability |

**Buggy code:**
```typescript
// src/lib/server/db.ts  lines 17-19
export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
export const getClient = () => pool.connect();   // ← DUPLICATE — TypeScript error TS2300
```

`getClient` is declared twice with identical signatures. TypeScript raises **TS2300 "Duplicate identifier"** and the module fails to compile, meaning no import of `db.ts` will succeed in a strict build.

**Suggested fix:**
```typescript
// src/lib/server/db.ts  lines 17-19 — remove the duplicate line
export const query     = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
```

---

### C-02 — Scoring rule inline fallbacks disagree with `DEFAULT_RULES` — wrong points on partial config

| Field | Value |
|---|---|
| **Severity** | Critical |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 35, 200, 201 |
| **Category** | Scoring correctness |

**Buggy code:**
```typescript
// calculateGroupScores — line 35
const ptsPerPosition = rules.group_position ?? 3;    // ← DEFAULT_RULES says 2, not 3

// calculateMatchScores — lines 200-201
const outcomePts = rules.match_outcome ?? 2;          // ← DEFAULT_RULES says 1, not 2
const exactPts   = rules.exact_score   ?? 5;          // ← DEFAULT_RULES says 3, not 5
```

`getScoringRules()` only returns `DEFAULT_RULES` when the pool has **zero** rows in `scoring_config`. For pools that have **any** rows configured (e.g., an admin saved deadlines but left some rules at default), the function returns only the persisted rows — without merging back the defaults for missing keys. Any missing key is then `undefined`, so the `??` fallbacks above kick in with incorrect values.

Example failure scenario:
1. Pool is created → 10 default rows inserted into `scoring_config`.
2. Admin deletes the `group_position` row to "clear" it — or a migration left a partial insert.
3. `rules.group_position` is `undefined` → `ptsPerPosition = 3` instead of 2 → every correct position earns **50% too many** points.

**Root cause fix — `getScoringRules` must always merge defaults:**
```typescript
// src/lib/server/scoring.ts — getScoringRules
export async function getScoringRules(poolId: number): Promise<Record<string, number>> {
  const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
  // Start with defaults; DB rows override them (never leave a key undefined)
  const config: Record<string, number> = { ...DEFAULT_RULES };
  for (const row of rows) config[row.rule] = row.points;
  return config;
}
```

Then remove the now-redundant inline fallbacks:
```typescript
const ptsPerPosition = rules.group_position;   // always defined after fix
const outcomePts     = rules.match_outcome;
const exactPts       = rules.exact_score;
```

---

### C-03 — Knockout matches decided by penalties silently award zero bracket points

| Field | Value |
|---|---|
| **Severity** | Critical |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 137–144 |
| **Category** | Scoring correctness / data model gap |

**Buggy code:**
```typescript
// calculateBracketScores — lines 137-140
for (const m of matches) {
  if (m.home_score === m.away_score) {
    console.warn(`[scoring] Knockout match ${m.id} has equal scores — skipping…`);
    continue;    // ← match is skipped; no bracket points awarded to anyone
  }
```

In the World Cup knockout stage, matches can finish level after 90 min and go to extra time/penalties. Typically the DB stores the 90-min (or AET) score, which can be equal (e.g., 1–1). The code skips any match with equal scores, so every bracket prediction for that match permanently earns 0 points regardless of whether the correct team advances.

The schema has no column to record the **penalty winner** separately from the scoreline.

**Suggested fix — add a `penalty_winner_id` column to `matches`:**

```sql
-- new migration
ALTER TABLE matches ADD COLUMN penalty_winner_id INTEGER REFERENCES teams(id);
```

```typescript
// calculateBracketScores — revised winner determination
const winner =
  m.home_score > m.away_score  ? m.home_team_id :
  m.home_score < m.away_score  ? m.away_team_id :
  m.penalty_winner_id          ? m.penalty_winner_id :
  null;   // still undecided (ongoing or data missing)

if (winner === null) {
  // No result yet; don't skip — just don't add to phaseWinners
  continue;
}
```

The admin "results" endpoint should also accept `penalty_winner_id`:
```typescript
// admin/results/+server.ts — extend body type
const { match_id, home_score, away_score, penalty_winner_id = null } = await request.json();
// ...
await query(
  "UPDATE matches SET home_score=$1, away_score=$2, status='finished', penalty_winner_id=$4 WHERE id=$3",
  [home_score, away_score, match_id, penalty_winner_id]
);
```

---

## High Severity Findings

---

### H-01 — Null match-prediction scores treated as draw outcome

| Field | Value |
|---|---|
| **Severity** | High |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 243–246 |
| **Category** | Scoring correctness |

**Buggy code:**
```typescript
// calculateMatchScores — lines 243-246
let predOutcome: string;
if (mp.home_score > mp.away_score) predOutcome = '1';
else if (mp.home_score < mp.away_score) predOutcome = '2';
else predOutcome = 'X';   // ← triggered when mp.home_score OR mp.away_score is NULL
```

The `match_predictions` table allows `home_score` and `away_score` to be `NULL` (schema lines 83–84 in `0001_initial.sql`). JS comparisons with `null` (`null > 1 === false`, `null < 1 === false`) silently fall through to the `else` branch, classifying the prediction as a draw (`'X'`). If the actual match also happens to be a draw, this prediction incorrectly receives `match_outcome` points.

**Suggested fix:**
```typescript
// Guard before outcome derivation
if (mp.home_score === null || mp.away_score === null) continue;  // skip incomplete predictions

let predOutcome: string;
if (mp.home_score > mp.away_score) predOutcome = '1';
else if (mp.home_score < mp.away_score) predOutcome = '2';
else predOutcome = 'X';
```

---

### H-02 — `mapFifaStageToPhase` always returns `'group'` — all FIFA-sourced bracket phases wrong

| Field | Value |
|---|---|
| **Severity** | High |
| **File** | `src/lib/server/live-scores.ts` |
| **Lines** | 99, 194–205 |
| **Category** | FIFA API sync correctness |

**Buggy code:**
```typescript
// fetchFromFifaApi — line 99 (call site)
phase: mapFifaStageToPhase(m.idStage),

// mapFifaStageToPhase — lines 194-205
function mapFifaStageToPhase(stageId: string): string {
  const map: Record<string, string> = {
    'group': 'group',   // ← expects literal string "group"
    'r32': 'r32',       //    FIFA actually returns numeric IDs like "275072"
    'r16': 'r16',
    // …
  };
  return map[stageId] ?? 'group';   // ← always falls back to 'group'
}
```

FIFA's API returns `idStage` as an **opaque numeric string** (e.g., `"275073"` for Round of 32), not human-readable labels. The map's keys will never match, so every match fetched from the FIFA API is tagged as `phase = 'group'`. Knockout results synced via the FIFA path will be stored in the DB with the wrong phase, breaking bracket scoring entirely.

**Suggested fix — map the real FIFA 2026 stage IDs (verify against live API before tournament):**
```typescript
// FIFA World Cup 2026 — verify these IDs before tournament starts
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
  return FIFA_STAGE_MAP[stageId] ?? 'unknown';  // 'unknown' surfaces bad IDs
}
```

Add a separate script/test that calls the FIFA API, dumps `idStage` values, and verifies the map before the tournament begins.

---

### H-03 — `getScoringRules` drops defaults for partial configs

| Field | Value |
|---|---|
| **Severity** | High |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 17–23 |
| **Category** | Scoring correctness |

This is the root cause of C-02 and deserves its own entry. See C-02 for the fix. The function should merge DB rows over defaults rather than returning only one or the other:

```typescript
// Current (broken for partial configs)
if (rows.length === 0) return { ...DEFAULT_RULES };
const config: Record<string, number> = {};
for (const row of rows) config[row.rule] = row.points;
return config;   // missing rules are undefined

// Fixed
const config: Record<string, number> = { ...DEFAULT_RULES };
for (const row of rows) config[row.rule] = row.points;
return config;
```

---

### H-04 — TOCTOU race in prediction creation bypasses `allow_multiple = false`

| Field | Value |
|---|---|
| **Severity** | High |
| **File** | `src/routes/api/predictions/entry/+server.ts` |
| **Lines** | 24–45 |
| **Category** | Concurrency / data integrity |

**Buggy code:**
```typescript
if (!pool.allow_multiple_predictions) {
  const { rows: existingRows } = await query(
    'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2',
    [pool_id, locals.user.id]
  );
  if (existingRows.length > 0) {
    return json({ error: '…' }, { status: 403 });
  }
}
// — gap: another request can pass the check and reach here simultaneously —
const result = await createPrediction(pool_id, locals.user.id, label);
```

Two concurrent requests from the same user (double-click, network retry) both pass the "no existing prediction" SELECT, then both call `createPrediction`. The DB `UNIQUE(pool_id, user_id, label)` constraint only prevents **same-label duplicates**, so if both requests have distinct labels, two entries are created in a pool that should allow only one.

**Suggested fix — enforce at the DB level with a partial unique index:**
```sql
-- migration: prevent multiple entries when pool disallows them
-- This requires knowing the pool setting at INSERT time, so use an INSERT guard instead:

-- Option A: application-level advisory lock
-- Option B: enforce via a DB function/trigger
-- Option C (simplest): use INSERT … ON CONFLICT with a subquery guard
```

Most practical immediate fix — perform the check and insert in the same transaction with a lock:
```typescript
const client = await getClient();
try {
  await client.query('BEGIN');
  // Re-check under lock
  const { rows: existing } = await client.query(
    'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2 FOR UPDATE',
    [pool_id, locals.user.id]
  );
  if (!pool.allow_multiple_predictions && existing.length > 0) {
    await client.query('ROLLBACK');
    return json({ error: 'Ya tienes una predicción…' }, { status: 403 });
  }
  // safe INSERT here
  await client.query('COMMIT');
} finally { client.release(); }
```

---

### H-05 — FIFA API competition ID is unverified placeholder

| Field | Value |
|---|---|
| **Severity** | High |
| **File** | `src/lib/server/live-scores.ts` |
| **Lines** | 79 |
| **Category** | FIFA API sync / data correctness |

**Buggy code:**
```typescript
const res = await fetch(
  `${FIFA_BASE}/matches/competitions/254648?status=completed`,
  { headers: { 'Accept': 'application/json' } }
);
```

The competition ID `254648` and query parameter `status=completed` are not documented by FIFA's public API and may be incorrect for the 2026 World Cup. If the endpoint returns a 4xx/5xx or an empty `results` array, `fetchFromFifaApi` returns `[]` silently (line 107: `return []`), falling through as if no matches exist — there's no alerting.

**Suggested fix:**
1. Verify the 2026 WC competition ID against FIFA's API before the tournament.  
2. Log a warning (not just silent empty return) when the response is unexpected:
```typescript
if (!res.ok) {
  console.error(`[live-scores] FIFA API error: ${res.status} ${res.statusText}`, await res.text());
  return [];
}
const data = await res.json();
if (!data.results || !Array.isArray(data.results)) {
  console.warn('[live-scores] FIFA API unexpected response shape:', JSON.stringify(data).slice(0, 200));
  return [];
}
```

---

## Medium Severity Findings

---

### M-01 — `syncScores` N+1 query pattern — up to 3 DB queries per match

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/live-scores.ts` |
| **Lines** | 131–176 |
| **Category** | Performance / API safety |

**Buggy code:**
```typescript
for (const m of matches) {                       // for each of 64+ matches:
  if (m.status !== 'finished') { skipped++; continue; }

  let dbMatch: any = null;
  if (m.fifa_id) {
    const res = await query('SELECT * FROM matches WHERE fifa_id = $1', [m.fifa_id]);  // query 1
    dbMatch = res.rows[0] ?? null;
  }
  if (!dbMatch) {
    const res = await query(`SELECT m.* … WHERE t1.name LIKE … LIMIT 1`, […]);        // query 2
    dbMatch = res.rows[0] ?? null;
  }
  if (!dbMatch) { skipped++; continue; }

  await query(`UPDATE matches SET … WHERE id = $3 AND status != 'finished'`, […]);    // query 3
}
```

For 64 World Cup matches this issues up to **192 sequential queries**. The external fetch to API-Football or FIFA counts against a rate quota, but the downstream DB hammering on every admin trigger is unnecessary.

**Suggested fix — bulk fetch, then batch update:**
```typescript
// Fetch all DB matches in one query
const { rows: dbMatches } = await query(`
  SELECT m.id, m.fifa_id, m.status, t1.name AS home_name, t2.name AS away_name
  FROM matches m
  JOIN teams t1 ON t1.id = m.home_team_id
  JOIN teams t2 ON t2.id = m.away_team_id
`);
const byFifaId  = new Map(dbMatches.filter(r => r.fifa_id).map(r => [r.fifa_id, r]));
const byNames   = new Map(dbMatches.map(r => [`${r.home_name}|${r.away_name}`, r]));

// Collect updates
const ids: number[] = [], home: number[] = [], away: number[] = [], kicks: (Date|null)[] = [];
for (const m of finishedMatches) {
  const db = byFifaId.get(m.fifa_id) ?? byNames.get(`${m.home_team}|${m.away_team}`);
  if (!db || db.status === 'finished') continue;
  ids.push(db.id); home.push(m.home_score); away.push(m.away_score); kicks.push(m.kickoff_time);
}

// Single bulk update
if (ids.length > 0) {
  await query(`
    UPDATE matches SET home_score=v.h, away_score=v.a, status='finished',
      kickoff_time = COALESCE(kickoff_time, v.k)
    FROM unnest($1::int[], $2::int[], $3::int[], $4::timestamptz[]) AS v(id,h,a,k)
    WHERE matches.id = v.id AND matches.status != 'finished'
  `, [ids, home, away, kicks]);
}
```

---

### M-02 — Fuzzy LIKE team-name matching can update the wrong match

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/live-scores.ts` |
| **Lines** | 144–154 |
| **Category** | Data integrity |

**Buggy code:**
```typescript
const escapeLike = (s: string) => s.replace(/[%_]/g, '\\$&');
const res = await query(`
  SELECT m.* FROM matches m
  JOIN teams t1 ON t1.id = m.home_team_id
  JOIN teams t2 ON t2.id = m.away_team_id
  WHERE (t1.name LIKE $1 ESCAPE '\\' AND t2.name LIKE $2 ESCAPE '\\')
    AND m.status != 'finished'
  LIMIT 1
`, [`%${escapeLike(m.home_team)}%`, `%${escapeLike(m.away_team)}%`]);
```

`%..%` substring matching will ambiguously match if the API returns `"Korea Republic"` and the DB also has `"Korea Republic U23"`. `LIMIT 1` silently picks one row — there is no date or phase filter to narrow the correct match. A false match writes scores to the wrong row.

**Suggested fix — add `kickoff_time` proximity filter and stricter name equality:**
```typescript
// Prefer exact name match; fall back to LIKE only if needed, restricted by date window
const res = await query(`
  SELECT m.* FROM matches m
  JOIN teams t1 ON t1.id = m.home_team_id
  JOIN teams t2 ON t2.id = m.away_team_id
  WHERE t1.name = $1 AND t2.name = $2
    AND m.status != 'finished'
    AND ($3::timestamptz IS NULL OR ABS(EXTRACT(EPOCH FROM (m.kickoff_time - $3::timestamptz))) < 86400)
  LIMIT 1
`, [m.home_team, m.away_team, m.kickoff_time]);
```

If strict equality fails and a fuzzy fallback is still needed, restrict to same-day matches:
```typescript
AND DATE(m.kickoff_time AT TIME ZONE 'UTC') = DATE($3::timestamptz AT TIME ZONE 'UTC')
```

---

### M-03 — No rate-limit tracking for API-Football free-tier quota (100 req/day)

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/live-scores.ts` |
| **Lines** | 31–70 |
| **Category** | API safety |

`fetchFromApiFootball` makes one HTTP request per `syncScores` call. The free API-Football plan allows 100 requests per day. There is no counter, timestamp, or backoff logic. An admin (or a misconfigured cron job) can exhaust the daily quota in minutes by repeatedly hitting `/api/admin/sync-scores`.

**Suggested fix — persist the last-called timestamp and enforce a minimum interval in the DB or process-level:**
```typescript
// Process-level guard (works for single-server; use DB timestamp for multi-process)
let _lastApiFootballCall = 0;
const API_FOOTBALL_MIN_INTERVAL = 15 * 60 * 1000; // at most ~96/day

export async function fetchFromApiFootball(…): Promise<LiveMatch[]> {
  const now = Date.now();
  if (now - _lastApiFootballCall < API_FOOTBALL_MIN_INTERVAL) {
    console.warn('[live-scores] API-Football rate guard: too soon since last call');
    return [];
  }
  _lastApiFootballCall = now;
  // … existing fetch logic
}
```

For cross-process safety, store `last_api_football_call` in a `site_settings` row and use a SELECT…FOR UPDATE to enforce the interval.

---

### M-04 — No concurrency guard on `calculateAllScores` — duplicate scoring runs waste resources

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 278–327 |
| **Category** | Concurrency |

`calculateAllScores` can be triggered simultaneously from:
- `admin/results` (setImmediate)
- `admin/sync-scores` (setImmediate)
- `admin/fifa-sync` (synchronous loop)
- `admin/recalculate` (synchronous)
- `predictions/match-scores` (setImmediate per save)

If two concurrent runs start for the same `poolId`, they each acquire a DB client, run `BEGIN`, and proceed in parallel. PostgreSQL's MVCC means both see the same snapshot and write the same values, so the final result is correct — but each run holds a DB connection for the full duration and wastes CPU.

More critically: if one run starts between another run's read phase and write phase (e.g., a new match result is inserted), the first run's `total_score` UPDATE may overwrite values computed with more complete data by the second run.

**Suggested fix — use a PostgreSQL advisory lock:**
```typescript
export async function calculateAllScores(poolId: number): Promise<void> {
  const rules = await getScoringRules(poolId);
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Acquire pool-scoped advisory lock (non-blocking: skip if already running)
    const { rows } = await client.query(
      'SELECT pg_try_advisory_xact_lock($1) AS acquired',
      [poolId]
    );
    if (!rows[0].acquired) {
      await client.query('ROLLBACK');
      return; // another process is already scoring this pool
    }
    // … existing scoring logic
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

---

### M-05 — `invalidateTeamsCache()` never called — stale team data persists for process lifetime

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/cache.ts` |
| **Lines** | 36–39 |
| **Category** | Cache invalidation |

`invalidateTeamsCache()` is exported from `cache.ts` but a codebase-wide search confirms it is **never called**. The teams cache (`_teams`) is populated once on first use and held indefinitely. If a team record is updated (e.g., correcting a name or flag code), the change is invisible until the process restarts.

The bracket prediction endpoint (`predictions/bracket`) validates team IDs against `getTeamsMapCached()`. Adding a new team would not be visible for existing processes.

**Suggested fix:**

1. Call `invalidateTeamsCache()` in any admin endpoint that modifies team data.
2. For the interim, add a short TTL to the teams cache:
```typescript
// cache.ts
let _teamsCachedAt = 0;
const TEAMS_TTL = 3_600_000; // 1 hour

export async function getAllTeamsCached(): Promise<any[]> {
  if (_teams && Date.now() - _teamsCachedAt < TEAMS_TTL) return _teams;
  const result = await query('SELECT * FROM teams ORDER BY group_name, fifa_rank');
  _teams = result.rows as any[];
  _teamsMap = null; // force rebuild
  _teamsCachedAt = Date.now();
  return _teams;
}
```

---

### M-06 — No cache invalidation after scoring rule changes in `admin/scoring`

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/routes/api/admin/scoring/+server.ts` |
| **Lines** | 57–88 |
| **Category** | Cache invalidation |

When an admin changes scoring rules or deadlines via `POST /api/admin/scoring`, the pool's leaderboard and results caches are **not invalidated**. Users will see stale leaderboard data for up to 60 seconds after a rule change.

**Suggested fix:**
```typescript
// admin/scoring/+server.ts — after updating rules/deadlines
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';

// … existing update logic …

invalidateCachedPoolLeaderboard(pool_id);
invalidateCachedPoolResults(pool_id);
invalidateGlobalLeaderboard();

await logAudit(…);
return json({ ok: true });
```

---

### M-07 — `predictions/match-scores` saves each score in a separate query — N+1

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/routes/api/predictions/match-scores/+server.ts` |
| **Lines** | 79–99 |
| **Category** | Performance |

**Buggy code:**
```typescript
for (const [matchIdStr, score] of Object.entries(scores)) {
  // …
  await query('DELETE FROM match_predictions …');   // or
  await query(`INSERT INTO match_predictions … ON CONFLICT … DO UPDATE …`);
}
```

With 104 matches in the 2026 World Cup group stage, a user submitting all predictions at once issues 104 sequential queries. This also triggers a full `calculateAllScores` for every save, regardless of whether anything changed.

**Suggested fix — split null/valid scores, then use bulk unnest for the upsert:**
```typescript
// Separate deletes from upserts
const deleteIds: number[] = [];
const upsertIds: number[] = [], upsertHome: number[] = [], upsertAway: number[] = [];

for (const [matchIdStr, score] of Object.entries(scores)) {
  const matchId = Number(matchIdStr);
  const h = score.home_score != null ? Number(score.home_score) : null;
  const a = score.away_score != null ? Number(score.away_score) : null;
  if (h === null || a === null || isNaN(h) || isNaN(a) || h < 0 || a < 0) {
    deleteIds.push(matchId);
  } else {
    upsertIds.push(matchId); upsertHome.push(h); upsertAway.push(a);
  }
}

if (deleteIds.length > 0) {
  await query(
    'DELETE FROM match_predictions WHERE prediction_id=$1 AND match_id=ANY($2::int[])',
    [prediction_id, deleteIds]
  );
}
if (upsertIds.length > 0) {
  await query(`
    INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score)
    SELECT $1, v.mid, v.h, v.a
    FROM unnest($2::int[], $3::int[], $4::int[]) AS v(mid, h, a)
    ON CONFLICT (prediction_id, match_id) DO UPDATE
      SET home_score=EXCLUDED.home_score, away_score=EXCLUDED.away_score, points_earned=0
  `, [prediction_id, upsertIds, upsertHome, upsertAway]);
}
```

---

### M-08 — `admin/fifa-sync` recalculates all pools synchronously — response may time out

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/routes/api/admin/fifa-sync/+server.ts` |
| **Lines** | 24–30 |
| **Category** | Performance / availability |

**Buggy code:**
```typescript
const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
for (const p of pools) {
  await calculateAllScores(p.id);       // synchronous — holds request open
  invalidateCachedPoolLeaderboard(p.id);
  invalidateCachedPoolResults(p.id);
}
```

With 10+ active pools, `calculateAllScores` runs sequentially inside the HTTP handler, potentially timing out (SvelteKit/Node default: 30s). By contrast, `admin/sync-scores` defers to `setImmediate`. The inconsistency can cause the admin UI to hang.

**Suggested fix — match the async pattern used by `sync-scores`:**
```typescript
const poolIds = pools.map((p: any) => p.id);

setImmediate(async () => {
  for (const poolId of poolIds) {
    try {
      await calculateAllScores(poolId);
      invalidateCachedPoolLeaderboard(poolId);
      invalidateCachedPoolResults(poolId);
    } catch (e) {
      console.error(`[bg-score] fifa-sync pool ${poolId}:`, e);
    }
  }
  invalidateGlobalLeaderboard();
});

return json({ ok: true, updated: 0, message: '…', pools: pools.length, scoring: 'pending' });
```

---

### M-09 — Tiebreaker data is stored but never used in scoring or leaderboard ordering

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/lib/server/scoring.ts`, `src/lib/server/queries.ts` |
| **Lines** | `scoring.ts:278–327`, `queries.ts:188–199` |
| **Category** | Feature completeness / scoring correctness |

The `tiebreaker` table stores users' predicted final match score. The `/api/predictions/tiebreaker` endpoints work correctly. However:

1. `calculateAllScores` has no `calculateTiebreakerScores` call — tiebreaker predictions never earn points.
2. `getPoolLeaderboard` orders by `total_score DESC, updated_at ASC` — the tiebreaker score is not considered when two predictions tie.

Users who fill in their tiebreaker score receive no benefit from it.

**Suggested fix:**

Option A (tiebreaker as points): add a scoring rule `tiebreaker_exact` and score it in `calculateAllScores` once the final result is known.

Option B (tiebreaker as leaderboard tiebreaker only):
```sql
-- In getPoolLeaderboard query
ORDER BY p.total_score DESC,
  -- closest tiebreaker to actual final score wins
  ABS(COALESCE(t.home_score,999) - :actual_home) + ABS(COALESCE(t.away_score,999) - :actual_away) ASC,
  p.updated_at ASC
```

At minimum, document in code/UI which behaviour is intended.

---

### M-10 — Admin auth inconsistency — some endpoints re-query DB, others trust `locals.user`

| Field | Value |
|---|---|
| **Severity** | Medium |
| **File** | `src/routes/api/admin/fifa-sync/+server.ts` vs `src/routes/api/admin/sync-scores/+server.ts` |
| **Lines** | `fifa-sync:10–15`, `sync-scores:12–14` |
| **Category** | Security / consistency |

```typescript
// admin/fifa-sync — re-queries DB every call
const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
if (!userRows[0]?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

// admin/sync-scores — trusts locals (from session cache, possibly 60s stale)
if (!locals.user.is_admin) return json({ error: 'Prohibido' }, { status: 403 });
```

The two most powerful admin endpoints have different security semantics. `fifa-sync` correctly fetches fresh `is_admin` from the DB (admin revocation is immediately effective). `sync-scores` trusts the session-cached value which can be up to 60 seconds stale after revocation. `admin/results` also re-queries, but `admin/recalculate` uses `locals.user.id` to verify pool ownership.

**Suggested fix — standardise on DB re-query for all admin privilege checks, or reduce SESSION_TTL:**
```typescript
// shared helper (e.g. src/lib/server/auth.ts)
export async function requireAdmin(locals: App.Locals): Promise<Response | null> {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const { rows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
  if (!rows[0]?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });
  return null;
}
```

---

## Low Severity Findings

---

### L-01 — `Pool` TypeScript interface uses `allow_multiple` — DB column is `allow_multiple_predictions`

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/lib/server/types.ts` |
| **Lines** | 16 |
| **Category** | Type safety |

```typescript
// types.ts line 16 — wrong field name
allow_multiple: boolean;

// DB schema (0001_initial.sql line 26) and all runtime code use:
allow_multiple_predictions
```

Runtime code casts pool rows to `any` or uses the correct DB column name directly, so there are no functional failures today. But if a type-safe path is ever added, it will silently read `undefined`.

**Fix:** rename the type field:
```typescript
allow_multiple_predictions: boolean;
```

---

### L-02 — `getPoolMembers` has typo in column alias: `od_user_id` instead of `user_id`

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/lib/server/queries.ts` |
| **Lines** | 154 |
| **Category** | Data correctness |

```typescript
// queries.ts line 154
`SELECT u.id as od_user_id, u.username, u.display_name, …`
//                ^^^ typo — should be user_id
```

Any calling code that accesses `.user_id` on a pool member row will receive `undefined`; they must use `.od_user_id`. Currently callers use raw loops so it works, but any future code expecting `user_id` will silently fail.

**Fix:** `u.id as user_id`

---

### L-03 — `audit_log` table has no indexes — admin audit queries will full-scan

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `drizzle/migrations/0005_audit_log.sql` |
| **Lines** | 1–11 |
| **Category** | Performance |

The `audit_log` table (created in migration 0005) has only the primary key. Any query filtering by `user_id`, `entity`, `action`, or `created_at` will full-scan the table.

**Suggested migration:**
```sql
CREATE INDEX idx_audit_user_id    ON audit_log(user_id);
CREATE INDEX idx_audit_entity     ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_created_at ON audit_log(created_at DESC);
```

---

### L-04 — Rate-limiting map is process-local — resets on server restart, bypassed with multiple processes

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/routes/api/auth/[action]/+server.ts` |
| **Lines** | 4–19 |
| **Category** | Security |

```typescript
const _attempts = new Map<string, { count: number; resetAt: number }>();
```

The rate limit counter lives in process memory. It is reset on every deployment/restart and is not shared across multiple Node processes or serverless instances. An attacker can bypass it by:
1. Waiting for a deployment
2. Using multiple serverless cold-start instances in parallel (on Vercel/Railway)

For production resilience, store attempt counts in the `site_settings` table or a Redis/Neon-based counter.

---

### L-05 — DB connection pool `max: 10` may cause contention under concurrent scoring

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/lib/server/db.ts` |
| **Lines** | 9 |
| **Category** | Availability |

```typescript
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
```

Each `calculateAllScores` call holds a dedicated `PoolClient` for the duration of the transaction. If `admin/fifa-sync` triggers synchronous scoring for 10 active pools, it consumes all 10 connections simultaneously. Subsequent requests stall waiting for a connection.

`setImmediate`-based callers exacerbate this since they run outside the HTTP request lifecycle and don't benefit from any request-level concurrency limits.

**Suggested fix:**
- Increase `max` to 20 if the Neon plan supports it.
- Apply the advisory-lock fix from M-04 to serialize per-pool scoring and reduce connection hold time.

---

### L-06 — No CSRF protection on admin POST endpoints

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | All `src/routes/api/admin/*/+server.ts` |
| **Category** | Security |

Admin endpoints accept JSON POST requests without a CSRF token. The session cookie is `sameSite: 'lax'`, which protects against top-level navigation-based CSRF (GET requests following a redirect) but not against `fetch()`-based POSTs from a cross-origin page. An attacker who tricks an admin into visiting a malicious page could fire arbitrary admin actions.

**Suggested fix:** Add SvelteKit's built-in CSRF protection by checking the `Origin` header matches the server origin for all state-mutating requests, or adopt a double-submit cookie pattern.

---

### L-07 — `admin/fifa-sync` stub returns misleading `updated: 0` while silently recalculating scores

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/routes/api/admin/fifa-sync/+server.ts` |
| **Lines** | 19–41 |
| **Category** | Observability |

The endpoint comment says "TODO: When FIFA publishes 2026 WC API endpoints, activate this." The actual `syncScores()` function from `live-scores.ts` (which supports both API-Football and FIFA) is **never called** from this endpoint. Instead it only recalculates scores, then reports `updated: 0`. This is confusing:

- Admins pressing "FIFA Sync" expect new match results to be fetched; they actually only trigger a recalculation.
- The real sync lives at `/api/admin/sync-scores` — there are now two recalculate-only paths with different response contracts.

**Suggested fix:**
- Remove the stub or replace its implementation with a call to `syncScores()` (which already tries API-Football first).
- Remove `admin/fifa-sync` if `admin/sync-scores` covers the same use case.

---

### L-08 — `predictions/match-scores` endpoint accepts predictions for matches outside the pool's tournament

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/routes/api/predictions/match-scores/+server.ts` |
| **Lines** | 78–99 |
| **Category** | Data integrity |

The endpoint verifies the `prediction_id` belongs to the user and pool, but does **not** verify that the submitted `match_id` values exist in the `matches` table for the correct tournament. A user submitting `match_id = 99999` (not in the DB) will receive a **PostgreSQL foreign-key violation**, caught by the `catch (e)` block and returned as a generic 500 error. The error message leaks no DB details, but the 500 response is undesirable.

**Suggested fix:** Validate submitted match IDs against the DB before the write loop:
```typescript
if (matchIds.length > 0) {
  const { rows: validMatches } = await query(
    'SELECT id FROM matches WHERE id = ANY($1::int[])',
    [matchIds]
  );
  const validIds = new Set(validMatches.map((r: any) => r.id));
  const invalid = matchIds.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    return json({ error: `Partidos inválidos: ${invalid.join(', ')}` }, { status: 400 });
  }
}
```

---

### L-09 — `total_score` UPDATE uses correlated subqueries — slow for large pools

| Field | Value |
|---|---|
| **Severity** | Low |
| **File** | `src/lib/server/scoring.ts` |
| **Lines** | 292–305 |
| **Category** | Performance |

```sql
UPDATE predictions p SET total_score = sub.total, updated_at = NOW()
FROM (
  SELECT pred.id,
    COALESCE((SELECT SUM(gp.points_earned) FROM group_predictions gp
              WHERE gp.prediction_id = pred.id), 0) +
    COALESCE((SELECT SUM(bp.points_earned) FROM bracket_predictions bp
              WHERE bp.prediction_id = pred.id), 0) +
    COALESCE((SELECT SUM(mp.points_earned) FROM match_predictions mp
              WHERE mp.prediction_id = pred.id), 0) AS total
  FROM predictions pred
  WHERE pred.pool_id = $1
) sub
WHERE p.id = sub.id
```

Three correlated subqueries execute **once per prediction row**. For a pool with 200 members this is 600 extra lookups. A join-based aggregation is equivalent and runs in one pass:

```sql
UPDATE predictions p
SET total_score = sub.total, updated_at = NOW()
FROM (
  SELECT pred.id,
    COALESCE(SUM(gp.points_earned), 0) +
    COALESCE(SUM(bp.points_earned), 0) +
    COALESCE(SUM(mp.points_earned), 0) AS total
  FROM predictions pred
  LEFT JOIN group_predictions   gp ON gp.prediction_id = pred.id
  LEFT JOIN bracket_predictions bp ON bp.prediction_id = pred.id
  LEFT JOIN match_predictions   mp ON mp.prediction_id = pred.id
  WHERE pred.pool_id = $1
  GROUP BY pred.id
) sub
WHERE p.id = sub.id
```

---

## Summary Table

| ID | Severity | File | Line(s) | Description |
|---|---|---|---|---|
| C-01 | **Critical** | `db.ts` | 19 | Duplicate `getClient` export — TypeScript compiler error |
| C-02 | **Critical** | `scoring.ts` | 35, 200, 201 | Inline rule fallbacks wrong (3/2/5 vs DEFAULT_RULES 2/1/3) |
| C-03 | **Critical** | `scoring.ts` | 137–144 | Penalty-decided matches silently skipped — no bracket points ever awarded |
| H-01 | **High** | `scoring.ts` | 243–246 | Null match scores treated as 0-0 draw — false outcome points |
| H-02 | **High** | `live-scores.ts` | 99, 194–205 | `mapFifaStageToPhase` always returns `'group'` — numeric FIFA IDs not mapped |
| H-03 | **High** | `scoring.ts` | 17–23 | `getScoringRules` drops DEFAULT_RULES for partial pool configs |
| H-04 | **High** | `predictions/entry` | 24–45 | TOCTOU race — two concurrent requests can create duplicate predictions |
| H-05 | **High** | `live-scores.ts` | 79 | FIFA competition ID `254648` is unverified placeholder; silent empty return on failure |
| M-01 | Medium | `live-scores.ts` | 131–176 | N+1: up to 3 queries per match in `syncScores` (should bulk-fetch + bulk-update) |
| M-02 | Medium | `live-scores.ts` | 144–154 | Fuzzy LIKE matching picks wrong match without date/phase filter |
| M-03 | Medium | `live-scores.ts` | 31–70 | No API-Football rate-limit guard — 100 req/day quota can be exhausted silently |
| M-04 | Medium | `scoring.ts` | 278–327 | No advisory lock on `calculateAllScores` — concurrent runs waste connections |
| M-05 | Medium | `cache.ts` | 36–39 | `invalidateTeamsCache()` exported but never called — team updates invisible |
| M-06 | Medium | `admin/scoring` | 57–88 | No cache invalidation after rule/deadline changes — stale leaderboard up to 60 s |
| M-07 | Medium | `predictions/match-scores` | 79–99 | N+1: one query per match score save; should use bulk unnest upsert |
| M-08 | Medium | `admin/fifa-sync` | 24–30 | Synchronous rescoring of all pools in HTTP handler — potential request timeout |
| M-09 | Medium | `scoring.ts`, `queries.ts` | — | Tiebreaker stored but never scored; not used in leaderboard ordering |
| M-10 | Medium | `admin/fifa-sync` vs `sync-scores` | — | Inconsistent admin auth: DB re-query vs stale `locals.user.is_admin` |
| L-01 | Low | `types.ts` | 16 | `Pool.allow_multiple` should be `allow_multiple_predictions` |
| L-02 | Low | `queries.ts` | 154 | Typo `od_user_id` alias in `getPoolMembers` — should be `user_id` |
| L-03 | Low | `0005_audit_log.sql` | 1–11 | No indexes on `audit_log` — queries by user/entity will full-scan |
| L-04 | Low | `auth/[action]` | 4–19 | Rate-limit map is process-local — bypassed across restarts/instances |
| L-05 | Low | `db.ts` | 9 | `pool.max: 10` — insufficient under concurrent multi-pool scoring |
| L-06 | Low | `admin/*` | — | No CSRF protection on admin POST endpoints |
| L-07 | Low | `admin/fifa-sync` | 19–41 | Stub endpoint misleads: calls recalculate, not actual FIFA sync |
| L-08 | Low | `predictions/match-scores` | 78–99 | No validation that submitted match IDs belong to this tournament |
| L-09 | Low | `scoring.ts` | 292–305 | `total_score` UPDATE uses slow correlated subqueries — rewrite as JOIN |

---

*End of audit report. All line numbers refer to the state of the codebase at commit `1416cae`.*
