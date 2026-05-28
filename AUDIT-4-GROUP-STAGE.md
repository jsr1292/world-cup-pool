# Audit #4 — Group Stage Prediction Page

**Date:** 2026-05-28  
**Scope:** `src/routes/pool/[id]/predict/+page.svelte`, `+page.server.ts`, `src/routes/api/predictions/group/+server.ts`, `src/lib/server/queries.ts`, `src/lib/server/cache.ts`, `src/lib/server/seed.ts`, `drizzle/migrations/0001_initial.sql`  
**Reported symptoms:** Missing flags · Some groups have more than 4 teams · Some groups are missing entirely

---

## Executive Summary

All three reported symptoms share a common root cause: **the teams table cannot be re-seeded once matches exist** because FK constraints on `matches.home_team_id`, `matches.away_team_id`, and `matches.penalty_winner_id` reference `teams(id)` with no `ON DELETE CASCADE`. When the seed is re-run (e.g., to fix flag codes or group assignments), `DELETE FROM teams` throws a FK violation and the entire transaction rolls back — leaving stale team data indefinitely. On top of this structural problem, England and Scotland are seeded with the wrong `flag_code`, producing wrong/identical flags on the frontend.

---

## Findings

---

### BUG-1 — England and Scotland share `flag_code: 'GB'` (wrong flags for both teams)

| | |
|---|---|
| **File** | `src/lib/server/seed.ts:9` (Scotland) and `src/lib/server/seed.ts:37` (England) |
| **Severity** | HIGH |

**Bug description:**  
Both Scotland and England are seeded with `flag_code: 'GB'` (ISO 3166-1 alpha-2 code for the United Kingdom). The `flagEmoji()` helper on the predict page has special-case handling for `'ENG'` (returns `🏴󠁧󠁢󠁥󠁮󠁧󠁿`) and `'SCT'` (returns `🏴󠁧󠁢󠁳󠁣󠁴󠁿`), but since the DB stores `'GB'` for both, neither special case is ever triggered. Both teams display 🇬🇧 — the exact same UK flag. Users see two teams with indistinguishable flags, which manifests as "flag missing" (the flag shown is meaningless/wrong) and potentially as a duplicate entry.

**Root cause:**  
`flagEmoji()` (`+page.svelte:322–329`) hard-codes `'ENG'` and `'SCT'` as sentinel values, but `seed.ts` stores `'GB'` for both. The DB code and the renderer are out of sync.

```typescript
// +page.svelte:322
function flagEmoji(code) {
  if (!code) return '';
  if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';   // ← never triggered; DB has 'GB'
  if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';   // ← never triggered; DB has 'GB'
  if (code.length !== 2) return '🏳️';
  ...
}
```

**Suggested fix — `src/lib/server/seed.ts`:**

```diff
-  { name: 'Scotland', flag_code: 'GB', group_name: 'A', fifa_rank: 36 },
+  { name: 'Scotland', flag_code: 'SCT', group_name: 'A', fifa_rank: 36 },
```

```diff
-  { name: 'England', flag_code: 'GB', group_name: 'F', fifa_rank: 4 },
+  { name: 'England', flag_code: 'ENG', group_name: 'F', fifa_rank: 4 },
```

After fixing seed.ts, also run this SQL directly against the DB (since re-seeding may be blocked — see BUG-2):

```sql
UPDATE teams SET flag_code = 'ENG' WHERE name = 'England';
UPDATE teams SET flag_code = 'SCT' WHERE name = 'Scotland';
```

Then restart the server to flush the in-memory teams cache (see BUG-4).

---

### BUG-2 — `DELETE FROM teams` fails when matches exist; re-seeding is impossible

| | |
|---|---|
| **File** | `src/lib/server/seed.ts:103` |
| **Severity** | CRITICAL |

**Bug description:**  
`seed.ts` opens a transaction, runs `DELETE FROM teams`, then inserts 48 fresh rows. However, the `matches` table has FK columns `home_team_id`, `away_team_id` (schema `0001_initial.sql:57–58`) and `penalty_winner_id` (migration `0006_penalty_winner.sql:4`) that all reference `teams(id)` **without `ON DELETE CASCADE`**. Once any matches exist in the DB, `DELETE FROM teams` throws a FK constraint violation; the whole transaction rolls back; the old team data remains unchanged; and the seed process exits with code 1.

This is the **root cause of both "groups with more than 4 teams" and "some groups missing"**: once the initial seeding establishes group assignments, any subsequent correction (to fix group assignments or flag codes) is silently blocked. The DB is left with whatever team data was inserted originally — which may have been from an older version of the seed with different group letter assignments or fewer/more teams.

**Root cause:**  
No `ON DELETE CASCADE` (or `ON DELETE SET NULL`) on `matches.home_team_id`, `matches.away_team_id`, `matches.penalty_winner_id`. The seed has no fallback to update existing rows in place.

**Suggested fix — make `seed.ts` use upsert instead of delete+insert:**

```typescript
// Replace the DELETE + plain INSERT with a name-keyed upsert:
const insertSql = `
  INSERT INTO teams (name, flag_code, group_name, fifa_rank)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (name) DO UPDATE SET
    flag_code   = EXCLUDED.flag_code,
    group_name  = EXCLUDED.group_name,
    fifa_rank   = EXCLUDED.fifa_rank
`;

async function seed() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Remove the DELETE; upsert preserves IDs so FKs stay valid
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
}
```

This also requires adding a `UNIQUE(name)` constraint to the teams table (see BUG-3).

---

### BUG-3 — No `UNIQUE` constraint on `teams.name`; duplicate rows accumulate

| | |
|---|---|
| **File** | `drizzle/migrations/0001_initial.sql:41–47`, `src/lib/server/seed.ts:93–96` |
| **Severity** | CRITICAL |

**Bug description:**  
The teams table schema has no uniqueness constraint on `name` (or any column other than the PK `id`). If `seed.ts` is run on an **empty** DB (or after manually truncating dependent tables), it succeeds — but running it a **second time** (with no DELETE working) inserts 48 **additional** duplicate rows, giving each group 8 teams instead of 4. The INSERT has no `ON CONFLICT` clause, so every run appends blindly.

This is the **direct cause of "some groups have more than 4 teams."**

**Suggested fix — add a migration:**

```sql
-- drizzle/migrations/0008_teams_unique_name.sql
ALTER TABLE teams ADD CONSTRAINT teams_name_unique UNIQUE (name);
```

And update `seed.ts` to use the upsert shown in BUG-2's fix.

---

### BUG-4 — In-memory teams cache never invalidated after re-seed or direct DB update

| | |
|---|---|
| **File** | `src/lib/server/cache.ts:20–26`, `src/lib/server/queries.ts:233–235` |
| **Severity** | HIGH |

**Bug description:**  
`getAllTeamsCached()` loads all teams from the DB exactly once per process lifetime and stores them in module-level `_teams`. There is an `invalidateTeamsCache()` function but it is **never called** from the seed script or any admin endpoint. Because the seed runs as a separate Node.js process, it cannot reach the in-process cache of the running SvelteKit server. After fixing the DB directly (via SQL patch or re-seed), users will continue to see **stale team data** (wrong groups, wrong flag codes) until the server is manually restarted.

**Root cause:**  
Cache invalidation is missing from every write path that modifies team data.

**Suggested fix:**  
Add a `POST /api/admin/invalidate-teams-cache` endpoint (admin-only) that calls `invalidateTeamsCache()`, and call it from any admin operation that modifies the teams table. Alternatively, document that a server restart is required after every teams DB change.

```typescript
// src/routes/api/admin/invalidate-teams-cache/+server.ts
import { invalidateTeamsCache } from '$lib/server/cache.js';
import { json } from '@sveltejs/kit';
export const POST = async ({ locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'Forbidden' }, { status: 403 });
  invalidateTeamsCache();
  return json({ ok: true });
};
```

---

### BUG-5 — `teamsByGroup` receives teams with `group_name: null` and buries them silently

| | |
|---|---|
| **File** | `src/routes/pool/[id]/predict/+page.server.ts:16–20` |
| **Severity** | HIGH |

**Bug description:**  
`+page.server.ts` groups teams by `team.group_name` using a plain object. If any team in the DB has `group_name = null` (the column is nullable per the schema), JavaScript coerces `null` to the string key `'null'`, creating `teamsByGroup['null']`. The Svelte template iterates over the hardcoded `GROUP_NAMES` array (`['A'…'L']`), which never includes `'null'`. Those teams are silently dropped — they never appear in any group card. This explains **"some groups missing"** (specifically, the expected teams don't appear under their group).

**Root cause:**  
`group_name` column is `TEXT` (nullable) in the schema. The grouping code has no null guard.

**Suggested fix — `src/routes/pool/[id]/predict/+page.server.ts:16–20`:**

```typescript
// Group teams by group_name — skip teams with no group assigned
const teamsByGroup: Record<string, any[]> = {};
for (const team of teams) {
  if (!team.group_name) continue;  // ← add this guard
  if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
  teamsByGroup[team.group_name].push(team);
}
```

Note: this guard hides a data problem without fixing it. The real fix is ensuring all teams have valid `group_name` values in the DB.

---

### BUG-6 — `GROUP_NAMES` hardcoded to 12 groups; mismatches DB-driven group keys

| | |
|---|---|
| **File** | `src/routes/pool/[id]/predict/+page.svelte:8, 14, 19` |
| **Severity** | MEDIUM |

**Bug description:**  
`GROUP_NAMES = ['A','B','C','D','E','F','G','H','I','J','K','L']` is a static constant. The Svelte template iterates exclusively over these 12 letters. If the DB has teams assigned to groups with different letters (e.g., an older seed used only groups A–H for an 8-group WC format), those teams are permanently invisible. Conversely, if the DB is missing teams for some of these 12 letters, those group cards render empty. The progress tracker `progressPct = ... / 12 * 100` is also hardcoded to 12, so partial data corrupts the completion percentage.

**Suggested fix:**  
Derive `GROUP_NAMES` dynamically from `data.teamsByGroup` on the server and pass it to the client, or at minimum validate that the 12 expected groups are all present in `teamsByGroup` and surface a warning if any are missing.

```typescript
// +page.server.ts — add to load() return value:
const presentGroups = Object.keys(teamsByGroup).sort();

// +page.svelte:
const GROUP_NAMES = $derived(
  data.presentGroups.length > 0
    ? data.presentGroups
    : ['A','B','C','D','E','F','G','H','I','J','K','L']
);
const totalGroups = $derived(GROUP_NAMES.length);
const progressPct = $derived(Math.round((groupsCompleted / totalGroups) * 100));
```

---

### BUG-7 — API group save validates team ownership but not group-name case sensitivity

| | |
|---|---|
| **File** | `src/routes/api/predictions/group/+server.ts:108–111` |
| **Severity** | LOW |

**Bug description:**  
The POST handler validates that group names are in `VALID_GROUPS = new Set(['A'…'L'])`. If a client sends lowercase group names (e.g., `'a'`), the request is rejected with `Invalid group: a`. This is correct behavior but may be surprising if the frontend ever sends lowercase keys — for example, if `teamsByGroup` is built from lowercase DB values (see BUG-5) and the save path reflects them back. Currently not a runtime bug but a latent risk.

**Suggested fix:**  
Normalize group names to uppercase on receipt:

```typescript
// src/routes/api/predictions/group/+server.ts — after parsing body:
const groups: Record<string, ...> = {};
for (const [k, v] of Object.entries(rawGroups)) {
  groups[k.toUpperCase()] = v;
}
```

---

### BUG-8 — Per-group kickoff deadline check uses `kickoff_time` which can be NULL

| | |
|---|---|
| **File** | `src/routes/api/predictions/group/+server.ts:94–105` |
| **Severity** | LOW |

**Bug description:**  
The per-group deadline check queries:

```sql
SELECT DISTINCT group_name FROM matches
WHERE group_name = ANY($1::text[])
  AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()
```

The filter `kickoff_time IS NOT NULL` means that matches with a `NULL` kickoff_time are **never considered started**, even if the match has already been played. If match rows exist in the DB without a `kickoff_time` (which is nullable and can be missing until populated by a sync), users can continue editing group predictions for already-played groups. This could also make the per-group lock inconsistently applied compared to the pool-wide `deadline_group`.

**Suggested fix:**  
Rely on `status = 'finished'` in addition to kickoff time:

```sql
SELECT DISTINCT group_name FROM matches
WHERE group_name = ANY($1::text[])
  AND (
    (kickoff_time IS NOT NULL AND kickoff_time <= NOW())
    OR status = 'finished'
  )
```

---

## Recommended Fix Order

| Priority | Bug | Action |
|---|---|---|
| 1 | BUG-3 | Add `UNIQUE(name)` migration to prevent duplicate team rows |
| 2 | BUG-1 | SQL patch: `UPDATE teams SET flag_code='ENG'/'SCT'` + fix seed.ts |
| 3 | BUG-2 | Rewrite seed.ts to use upsert (`ON CONFLICT (name) DO UPDATE`) |
| 4 | BUG-4 | Add admin cache-invalidation endpoint; restart server after DB fix |
| 5 | BUG-5 | Add `if (!team.group_name) continue` guard in +page.server.ts |
| 6 | BUG-6 | Derive `GROUP_NAMES` dynamically from `data.teamsByGroup` |
| 7 | BUG-7 | Normalize group name keys to uppercase in the POST handler |
| 8 | BUG-8 | Add `OR status = 'finished'` to the per-group kickoff check |

## Immediate DB Recovery Steps

If the app is live and showing the symptoms right now:

```sql
-- 1. Fix flag codes
UPDATE teams SET flag_code = 'ENG' WHERE name = 'England';
UPDATE teams SET flag_code = 'SCT' WHERE name = 'Scotland';

-- 2. Check for duplicate teams
SELECT name, count(*) FROM teams GROUP BY name HAVING count(*) > 1;

-- 3. If duplicates exist — remove higher-ID dupes (keep original IDs to preserve FK refs)
DELETE FROM teams t
WHERE t.id NOT IN (
  SELECT MIN(id) FROM teams GROUP BY name
);

-- 4. Verify group distribution
SELECT group_name, count(*) FROM teams GROUP BY group_name ORDER BY group_name;
-- Expected: 12 rows each with count = 4

-- 5. After SQL fixes, restart the server to flush the in-memory teams cache
```
