# Fix Plan — Audit #4 Group Stage
**Date:** 2026-05-28  
**Branch target:** master  
**Applies to audit:** AUDIT-4-GROUP-STAGE.md

---

## Dependency order

```
Step 1  BUG-3  Migration: UNIQUE(name) on teams                  [schema gate — must land first]
Step 2  BUG-1  DB patch: fix flag_code for England/Scotland
Step 3  BUG-2  seed.ts: replace DELETE+INSERT with upsert         [needs UNIQUE constraint from Step 1]
Step 4  BUG-4  New admin endpoint: POST /api/admin/invalidate-teams-cache
Step 5  BUG-5  +page.server.ts: null guard on group_name
Step 6  BUG-6  +page.server.ts + +page.svelte: dynamic GROUP_NAMES
Step 7  BUG-7  +server.ts (group): normalize group keys to uppercase
Step 8  BUG-8  +server.ts (group): add OR status='finished' to kickoff check
```

---

## Step 1 — BUG-3: Add UNIQUE(name) migration on teams table

### 1a. Create migration file

**New file:** `drizzle/migrations/0008_teams_unique_name.sql`

```sql
-- 0008_teams_unique_name.sql
-- Adds a unique constraint on teams.name so ON CONFLICT (name) upserts work in seed.ts.
-- Before applying: remove any duplicate name rows to avoid constraint violation.

-- Remove higher-ID duplicates, keeping the row with the minimum id (preserves FK refs)
DELETE FROM teams t
WHERE t.id NOT IN (
  SELECT MIN(id) FROM teams GROUP BY name
);

ALTER TABLE teams ADD CONSTRAINT teams_name_unique UNIQUE (name);
```

### 1b. Verification

After applying the migration:
```sql
-- Should return the constraint row
SELECT conname FROM pg_constraint WHERE conname = 'teams_name_unique';

-- Should return 48 rows, each with count = 1
SELECT name, COUNT(*) FROM teams GROUP BY name HAVING COUNT(*) > 1;
-- Expected: 0 rows (no duplicates)

SELECT COUNT(*) FROM teams;
-- Expected: 48
```

---

## Step 2 — BUG-1: Fix flag_code for England and Scotland

### 2a. DB recovery SQL (run directly against Neon)

```sql
-- Fix flag codes
UPDATE teams SET flag_code = 'ENG' WHERE name = 'England';
UPDATE teams SET flag_code = 'SCT' WHERE name = 'Scotland';

-- Verify
SELECT name, flag_code FROM teams WHERE name IN ('England', 'Scotland');
-- Expected:
-- England | ENG
-- Scotland | SCT
```

### 2b. Fix seed.ts

**File:** `src/lib/server/seed.ts`

Line 9 — Scotland:
```typescript
// OLD
  { name: 'Scotland', flag_code: 'GB', group_name: 'A', fifa_rank: 36 },
// NEW
  { name: 'Scotland', flag_code: 'SCT', group_name: 'A', fifa_rank: 36 },
```

Line 37 — England:
```typescript
// OLD
  { name: 'England', flag_code: 'GB', group_name: 'F', fifa_rank: 4 },
// NEW
  { name: 'England', flag_code: 'ENG', group_name: 'F', fifa_rank: 4 },
```

### 2c. Verification

After the DB patch and server restart (see Step 4):
- Open the group predict page for any pool.
- Scotland (Group A) should display 🏴󠁧󠁢󠁳󠁣󠁴󠁿 instead of 🇬🇧.
- England (Group F) should display 🏴󠁧󠁢󠁥󠁮󠁧󠁿 instead of 🇬🇧.

---

## Step 3 — BUG-2: Rewrite seed.ts to use upsert (ON CONFLICT name DO UPDATE)

**File:** `src/lib/server/seed.ts`  
**Depends on:** Step 1 (UNIQUE constraint must exist before the ON CONFLICT clause is valid)

### Old code (lines 93–119)

```typescript
const insertSql = `
  INSERT INTO teams (name, flag_code, group_name, fifa_rank)
  VALUES ($1, $2, $3, $4)
`;

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM teams');

    for (const row of teams) {
      await client.query(insertSql, [row.name, row.flag_code, row.group_name, row.fifa_rank]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await query('SELECT COUNT(*) as c FROM teams') as { rows: { c: number }[] };
  console.log(`✓ Seeded ${result.rows[0].c} teams in ${Object.keys(groups).length} groups`);
}
```

### New code (replace lines 93–119)

```typescript
const insertSql = `
  INSERT INTO teams (name, flag_code, group_name, fifa_rank)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (name) DO UPDATE SET
    flag_code  = EXCLUDED.flag_code,
    group_name = EXCLUDED.group_name,
    fifa_rank  = EXCLUDED.fifa_rank
`;

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const row of teams) {
      await client.query(insertSql, [row.name, row.flag_code, row.group_name, row.fifa_rank]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const result = await query('SELECT COUNT(*) as c FROM teams') as { rows: { c: number }[] };
  console.log(`✓ Seeded ${result.rows[0].c} teams in ${Object.keys(groups).length} groups`);
}
```

### Verification

```bash
npx tsx src/lib/server/seed.ts
# Expected: ✓ Seeded 48 teams in 12 groups
# Re-run — must not throw FK error:
npx tsx src/lib/server/seed.ts
# Expected: same success output, no error
```

```sql
SELECT group_name, COUNT(*) FROM teams GROUP BY group_name ORDER BY group_name;
-- Expected: 12 rows, each count = 4
```

---

## Step 4 — BUG-4: Add admin cache-invalidation endpoint

**New file:** `src/routes/api/admin/invalidate-teams-cache/+server.ts`

```typescript
import { invalidateTeamsCache } from '$lib/server/cache.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
  invalidateTeamsCache();
  return json({ ok: true });
};
```

### Verification

As an admin user:
```bash
curl -X POST https://<your-domain>/api/admin/invalidate-teams-cache \
  -H 'Cookie: session=<admin-session-token>'
# Expected: {"ok":true}
```

As a non-admin user:
```bash
curl -X POST https://<your-domain>/api/admin/invalidate-teams-cache \
  -H 'Cookie: session=<non-admin-session-token>'
# Expected: {"error":"Forbidden"} with status 403
```

**After fixing the DB flag codes in Step 2**, call this endpoint (or restart the server) to flush the in-memory teams cache so the corrected flag codes take effect immediately.

---

## Step 5 — BUG-5: Add null guard for group_name in +page.server.ts

**File:** `src/routes/pool/[id]/predict/+page.server.ts`

### Old code (lines 15–20)

```typescript
  // Group teams by group_name
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }
```

### New code (lines 15–21)

```typescript
  // Group teams by group_name — skip teams with no group assigned
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!team.group_name) continue;
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }
```

### Verification

```sql
-- Temporarily set one team's group_name to null
UPDATE teams SET group_name = NULL WHERE name = 'Qatar';
```
Reload the predict page — Qatar must not appear in any group card and must not cause a `teamsByGroup['null']` key.  
Restore: `UPDATE teams SET group_name = 'L' WHERE name = 'Qatar';`

---

## Step 6 — BUG-6: Derive GROUP_NAMES dynamically from data

### 6a. +page.server.ts — expose presentGroups

**File:** `src/routes/pool/[id]/predict/+page.server.ts`

After the `teamsByGroup` loop (line 21, after Step 5's edit), insert one line, and add `presentGroups` to the return object.

**Insert after the teamsByGroup loop:**

```typescript
  const presentGroups = Object.keys(teamsByGroup).sort();
```

**Return object** — add `presentGroups` (around line 101):

```typescript
// OLD
  return {
    pool,
    teamsByGroup,
    entries,
    selectedId,
    selectedLabel: selectedPrediction?.label || '',
    isLocked,
    existingGroupPreds,
    knockoutByPhase,
    existingMatchPreds,
  };
// NEW
  return {
    pool,
    teamsByGroup,
    presentGroups,
    entries,
    selectedId,
    selectedLabel: selectedPrediction?.label || '',
    isLocked,
    existingGroupPreds,
    knockoutByPhase,
    existingMatchPreds,
  };
```

### 6b. +page.svelte — replace hardcoded GROUP_NAMES and 12s

**File:** `src/routes/pool/[id]/predict/+page.svelte`

**Change 1 — lines 8–19:** Replace static `GROUP_NAMES` const and hardcoded divisor

```typescript
// OLD (lines 8–19)
  const GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const pool = $derived(data.pool);
  const allowMultiple = $derived(!!data.pool.allow_multiple_predictions);

  // Progress tracking
  const groupsCompleted = $derived.by(() => {
    return GROUP_NAMES.filter(g => {
      const arr = selections[g] || [];
      return arr[0] != null && arr[1] != null && arr[2] != null && arr[3] != null;
    }).length;
  });
  const progressPct = $derived(Math.round((groupsCompleted / 12) * 100));
// NEW (lines 8–20)
  const GROUP_NAMES = $derived(
    data.presentGroups?.length > 0
      ? data.presentGroups
      : ['A','B','C','D','E','F','G','H','I','J','K','L']
  );
  const totalGroups = $derived(GROUP_NAMES.length);
  const pool = $derived(data.pool);
  const allowMultiple = $derived(!!data.pool.allow_multiple_predictions);

  // Progress tracking
  const groupsCompleted = $derived.by(() => {
    return GROUP_NAMES.filter(g => {
      const arr = selections[g] || [];
      return arr[0] != null && arr[1] != null && arr[2] != null && arr[3] != null;
    }).length;
  });
  const progressPct = $derived(Math.round((groupsCompleted / totalGroups) * 100));
```

**Change 2 — line 380–381:** Replace hardcoded 12 in progress display

```svelte
<!-- OLD (lines 380–382) -->
      <span style="font-size: 10px; color: {groupsCompleted === 12 ? 'var(--green)' : 'var(--text-dim)'}; font-weight: 500; white-space: nowrap;">
        {groupsCompleted === 12 ? '✅' : ''} {groupsCompleted}/12 grupos
      </span>
<!-- NEW -->
      <span style="font-size: 10px; color: {groupsCompleted === totalGroups ? 'var(--green)' : 'var(--text-dim)'}; font-weight: 500; white-space: nowrap;">
        {groupsCompleted === totalGroups ? '✅' : ''} {groupsCompleted}/{totalGroups} grupos
      </span>
```

### Verification

- With 12 groups in DB: page renders 12 group cards, progress bar denominator is 12.
- If you temporarily change one team to a 13th group letter `'M'` in the DB and call the cache-invalidation endpoint, the page should render 13 group cards and show `/13 grupos`.

---

## Step 7 — BUG-7: Normalize group name keys to uppercase in POST handler

**File:** `src/routes/api/predictions/group/+server.ts`

### Old code (lines 54–59)

```typescript
  const body = await request.json();
  const { prediction_id, groups: rawGroups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };
  const groups = { ...rawGroups }; // mutable copy so we can delete started groups
```

### New code (lines 54–62)

```typescript
  const body = await request.json();
  const { prediction_id, groups: rawGroups } = body as {
    prediction_id: number;
    groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }>;
  };
  // Normalize keys to uppercase so 'a' and 'A' are treated identically
  const groups: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};
  for (const [k, v] of Object.entries(rawGroups)) {
    groups[k.toUpperCase()] = v;
  }
```

### Verification

```bash
# Send lowercase group key — should save successfully, not return 400
curl -X POST /api/predictions/group \
  -H 'Content-Type: application/json' \
  -d '{"prediction_id":1,"groups":{"a":{"pos1":1,"pos2":2,"pos3":3,"pos4":4}}}'
# Expected: {"ok":true}  (not {"error":"Invalid group: a"})
```

---

## Step 8 — BUG-8: Add OR status='finished' to per-group kickoff check

**File:** `src/routes/api/predictions/group/+server.ts`

### Old code (lines 95–100)

```typescript
    const { rows: startedRows } = await query(
      `SELECT DISTINCT group_name FROM matches
       WHERE group_name = ANY($1::text[])
         AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()`,
      [groupNames]
    );
```

### New code (lines 95–102)

```typescript
    const { rows: startedRows } = await query(
      `SELECT DISTINCT group_name FROM matches
       WHERE group_name = ANY($1::text[])
         AND (
           (kickoff_time IS NOT NULL AND kickoff_time <= NOW())
           OR status = 'finished'
         )`,
      [groupNames]
    );
```

### Verification

```sql
-- Create a test scenario: match with null kickoff_time but status='finished'
UPDATE matches SET kickoff_time = NULL, status = 'finished'
WHERE group_name = 'A' LIMIT 1;
```
Then attempt to POST a group-A prediction — the group should be silently dropped from the save (locked), even without a kickoff_time.  
Restore: `UPDATE matches SET status = 'scheduled' WHERE group_name = 'A' AND kickoff_time IS NULL;`

---

## DB Recovery SQL (run in this order against Neon directly if app is live)

```sql
-- ── 1. Remove duplicate team rows ────────────────────────────────────────────
DELETE FROM teams t
WHERE t.id NOT IN (
  SELECT MIN(id) FROM teams GROUP BY name
);

-- ── 2. Add UNIQUE constraint (Step 1 migration) ──────────────────────────────
ALTER TABLE teams ADD CONSTRAINT teams_name_unique UNIQUE (name);

-- ── 3. Fix flag codes (Step 2 DB patch) ─────────────────────────────────────
UPDATE teams SET flag_code = 'ENG' WHERE name = 'England';
UPDATE teams SET flag_code = 'SCT' WHERE name = 'Scotland';

-- ── 4. Verify group distribution ─────────────────────────────────────────────
SELECT group_name, COUNT(*) FROM teams GROUP BY group_name ORDER BY group_name;
-- Expected: 12 rows each with count = 4

-- ── 5. Verify flag codes ──────────────────────────────────────────────────────
SELECT name, flag_code FROM teams WHERE name IN ('England', 'Scotland');
-- Expected: England → ENG, Scotland → SCT

-- ── 6. After SQL fixes, flush the server-side teams cache ────────────────────
-- Either restart the server, or call POST /api/admin/invalidate-teams-cache
-- (endpoint added in Step 4)
```

---

## Summary checklist

| Step | File(s) | Status |
|------|---------|--------|
| 1 BUG-3 | `drizzle/migrations/0008_teams_unique_name.sql` (new) | [ ] |
| 2 BUG-1 | Neon SQL + `src/lib/server/seed.ts:9,37` | [ ] |
| 3 BUG-2 | `src/lib/server/seed.ts:93–119` | [ ] |
| 4 BUG-4 | `src/routes/api/admin/invalidate-teams-cache/+server.ts` (new) | [ ] |
| 5 BUG-5 | `src/routes/pool/[id]/predict/+page.server.ts:17` | [ ] |
| 6 BUG-6 | `+page.server.ts:21,101` + `+page.svelte:8–19,380–382` | [ ] |
| 7 BUG-7 | `src/routes/api/predictions/group/+server.ts:59–62` | [ ] |
| 8 BUG-8 | `src/routes/api/predictions/group/+server.ts:96–100` | [ ] |
