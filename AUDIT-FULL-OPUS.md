# Mundial 2026 — Full Codebase Audit (Opus)

Scope: comprehensive review of `src/` (routes, lib/server, components, hooks),
migrations and seed data. Focus areas: bracket wiring correctness, scoring,
authn/authz, IDOR, SQL safety, validation, Svelte 5 reactivity, edge cases.

Severity legend: **CRITICAL** = data-integrity/security or wrong scores;
**HIGH** = broken feature or auth gap; **MEDIUM** = correctness or UX problem;
**LOW** = polish / minor cleanup.

---

## 1. CRITICAL findings

### 1.1 — Knockout bracket wiring (R32 → R16) does NOT match FIFA 2026 (CRITICAL — Logic)
**File:** `src/routes/pool/[id]/bracket/+page.svelte:36`

```js
const R32_TO_R16 = [0, 1, 2, 4, 3, 5, 6, 7, 10, 11, 9, 8, 13, 15, 14, 12];
```

The mapping says `R16[i] = winner( R32[R32_TO_R16[i*2]] vs R32[R32_TO_R16[i*2+1]] )`.
Decoded against `R32_MAP`, this produces the following R16 pairings (cross‑referenced
to FIFA's official match numbers M73–M88 for the 2026 draw, where the published
bracket pairs M73+M74→R16, M75+M76→R16, … M87+M88→R16):

| App R16 | Pair (R32 indices) | App labels (R32-#)    | FIFA equivalent match | FIFA correct pairing |
|---------|--------------------|------------------------|------------------------|------------------------|
| R16[0]  | R32[0]  vs R32[1]  | R32-1 vs R32-2  (M75+M76) | M90 ✓                | M75+M76 ✓             |
| R16[1]  | R32[2]  vs R32[4]  | R32-3 vs R32-5  (M81+M82) | M93 ✓                | M81+M82 ✓             |
| R16[2]  | R32[3]  vs R32[5]  | R32-4 vs R32-6  (M79+M80) | M92 ✓                | M79+M80 ✓             |
| R16[3]  | R32[6]  vs R32[7]  | R32-7 vs R32-8  (M83+M84) | M94 ✓                | M83+M84 ✓             |
| R16[4]  | R32[10] vs R32[11] | R32-11 vs R32-12 (M73+M74)| M89 ✓                | M73+M74 ✓             |
| **R16[5]** | **R32[9] vs R32[8]** | **R32-10 vs R32-9 (M87+M85)** | **NONE** | **should be M85+M86** |
| **R16[6]** | **R32[13] vs R32[15]** | **R32-14 vs R32-16 (M88+M78)** | **NONE** | **should be M77+M78 OR M87+M88** |
| **R16[7]** | **R32[14] vs R32[12]** | **R32-15 vs R32-13 (M77+M86)** | **NONE** | **should be ...** |

R16[5–7] mix the two halves of the bracket and produce pairings that do not exist
in the FIFA 2026 official bracket published on December 5, 2025. Three real R16
matchups are missing (M91 = M77+M78, M95 = M85+M86, M96 = M87+M88) and three
phantom pairings replace them.

**Concrete consequence:** if a user (correctly) predicts E.g. Brazil (1C) to beat
2F in R32-9 (M85) and Japan (1J) to beat 2H in R32-13 (M86), the app sends them
to different R16 matches — Brazil to R16[5] (where they meet the winner of 2E/2I
from M87) and Japan to R16[7] (where they meet the winner of B1/3rd from M77).
In reality both should advance into the same R16 match (M95).

**Fix.** Replace the array with the sequential FIFA pairing, swapping only what
the visual layout requires for left/right halves:

```js
// Map app R32 indices to FIFA match numbers, then pair adjacent FIFA matches.
// App index → FIFA match number:
//   0:M75 1:M76 2:M81 3:M79 4:M82 5:M80 6:M83 7:M84
//   8:M85 9:M87 10:M73 11:M74 12:M86 13:M88 14:M77 15:M78
//
// FIFA R16 pairs (adjacent matches): 73+74, 75+76, 77+78, 79+80,
//   81+82, 83+84, 85+86, 87+88
// → app pairs:
//   (10,11)=M89, (0,1)=M90, (14,15)=M91, (3,5)=M92,
//   (2,4)=M93, (6,7)=M94, (8,12)=M95, (9,13)=M96
//
// Choose an R16 order that keeps the existing visual layout:
const R32_TO_R16 = [
   0, 1,    // R16[0] = M90 (left)
   2, 4,    // R16[1] = M93
   3, 5,    // R16[2] = M92
   6, 7,    // R16[3] = M94
  10, 11,   // R16[4] = M89 (right)
   8, 12,   // R16[5] = M95  ← was 9, 8
   9, 13,   // R16[6] = M96  ← was 13, 15
  14, 15,   // R16[7] = M91  ← was 14, 12
];
```

Also update `R16_LABELS` accordingly:
```js
const R16_LABELS = [
  'W(R32-1) vs W(R32-2)',   // M90
  'W(R32-3) vs W(R32-5)',   // M93
  'W(R32-4) vs W(R32-6)',   // M92
  'W(R32-7) vs W(R32-8)',   // M94
  'W(R32-11) vs W(R32-12)', // M89
  'W(R32-9) vs W(R32-13)',  // M95   (was: 'W(R32-10) vs W(R32-9)')
  'W(R32-10) vs W(R32-14)', // M96   (was: 'W(R32-14) vs W(R32-16)')
  'W(R32-15) vs W(R32-16)', // M91   (was: 'W(R32-15) vs W(R32-13)')
];
```

And confirm/update `QF_LABELS` (currently `R16[0]+R16[1]`, `R16[4]+R16[5]`,
`R16[2]+R16[3]`, `R16[6]+R16[7]`) against the FIFA QFs — M97 = M89+M90,
M98 = M91+M92, M99 = M93+M94, M100 = M95+M96 → app QF pairings should be
`(R16[4]+R16[0])`, `(R16[7]+R16[2])`, `(R16[1]+R16[3])`, `(R16[5]+R16[6])`.
The current QF_LABELS list pairs sides that are not adjacent in the FIFA bracket
(QF-1 pairs M90 with M93, which sit in opposite halves of the FIFA bracket and
should only meet in the final); this needs to be corrected in tandem with the
R16 fix and verified against the official 2026 bracket diagram.

Without this fix, bracket scoring will reward picks that did not actually advance
together and will not award the legitimate winners' matches that the user picked
correctly — affecting `knockout_r16`, `knockout_qf`, `knockout_sf`, `knockout_final`
and `knockout_winner` on every prediction in every pool.

---

### 1.2 — IDOR: any logged‑in user can view any pool (CRITICAL — Security)
**File:** `src/routes/pool/[id]/+page.server.ts:7-15`

```ts
export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const members  = await getPoolMembers(poolId);
  const leaderboard = await getPoolLeaderboard(poolId);
  …
```

No check that `locals.user` is a member of the pool. The hooks file requires
*authentication* for `/pool/...` paths but does not enforce *membership*, so any
authenticated user can request `/pool/123` and obtain:

- full member list with display names and `has_paid` status
- every member's individual group/bracket picks (`userGroupPredsFull` etc.)
- pool buy‑in, deadlines, scoring config
- pool admin's identity (`created_by`)

The same gap exists in `pool/[id]/predict/+page.server.ts`,
`pool/[id]/bracket/+page.server.ts`, `pool/[id]/results/+page.server.ts`,
`pool/[id]/summary/+page.server.ts`. Each of those auto‑creates a fresh
`predictions` row only if the user is a member, but they still leak the rest of
the pool data when the user is not.

**Fix.** Add a membership gate:

```ts
const { rows: m } = await query(
  'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
  [poolId, locals.user?.id ?? 0]
);
if (m.length === 0 && pool.created_by !== locals.user?.id) {
  throw error(403, 'No eres miembro de esta quiniela');
}
```

(Or expose a strictly public, share‑token endpoint that *only* surfaces
leaderboard‑safe fields — which is what `/s/[code]` already does.)

---

### 1.3 — Cache‑coherent scoring across multiple processes (CRITICAL — Data)
**File:** `src/lib/server/cache.ts` (module‑level mutable state)

All caches (`_teams`, `_teamsMap`, `_sessionCache`, `_globalLeaderboard`,
`_poolLeaderboard`, `_poolResults`) live in process memory. The file header
calls this out. Today the side‑effect is:

- After admin sets a result via `/api/admin/results`, `invalidateCachedPoolLeaderboard`
  runs only on the handling process. Any other Node instance keeps serving stale
  leaderboards for up to 30s/60s.
- `invalidateCachedSession(token)` (`deleteSession`, `change-password`) only
  evicts on the local process, so a logout / password change on instance A still
  authenticates the next request that lands on instance B for up to 60s.

If deployment is single‑process, treat as MEDIUM; if there is any horizontal
scaling, treat as CRITICAL — the session bypass allows a logged‑out token to
keep authenticating for the cache TTL window. The README/comments acknowledge
this; calling it out so it isn't silently shipped on a multi‑instance host.

**Fix.** Either move the session cache to Postgres / Redis, or document
single‑instance as a hard deployment constraint and add a runtime assertion at
boot.

---

## 2. HIGH findings

### 2.1 — `change-password` missing rate limit (HIGH — Security)
**File:** `src/routes/api/auth/change-password/+server.ts`

Login is rate‑limited by IP (10/15 min) in `api/auth/[action]/+server.ts`, but
change‑password has no rate limit. With a stolen session cookie an attacker can
brute‑force `current_password` at whatever speed `crypto.scrypt` allows (and
that path also leaks scrypt timing). Combine with the in‑memory session cache
TTL (1.2 above) and a stolen-then-revoked session can still be abused.

**Fix.** Reuse `checkPredictionRate` or add an analogous `checkAuthRate` keyed
on `(userId, ip)` with e.g. 5 attempts / 15 minutes.

### 2.2 — `leaderboard/+page.server.ts` references a non‑aggregated column in ORDER BY (HIGH — Logic)
**File:** `src/routes/leaderboard/+page.server.ts:73`

```sql
SELECT  u.id, ..., COUNT(...), SUM(...)
FROM predictions p
JOIN users u ON u.id = p.user_id
LEFT JOIN tiebreaker_close tc ON tc.prediction_id = p.id
...
GROUP BY u.id
ORDER BY total_score DESC, exact_score_hits DESC, total_correct DESC, tc.closeness ASC
```

`tc.closeness` is not aggregated and `p.id` is not in `GROUP BY`. PostgreSQL
will accept this only because `u.id` is the PK (functional dependency lets the
non‑aggregate `tc.closeness` through), but it picks an *arbitrary* row from the
tiebreaker for each user — usually the first entry's closeness rather than the
best one across all of that user's pools/entries.

**Fix.** Aggregate, e.g. `MIN(tc.closeness)` (best closeness across the user's
entries):

```sql
ORDER BY total_score DESC,
         exact_score_hits DESC,
         total_correct DESC,
         MIN(tc.closeness) ASC NULLS LAST
```

### 2.3 — `kickoff_time` deadline filter relies on per‑server clock (HIGH — Logic)
**File:** `src/routes/api/predictions/bracket/+server.ts:98-108` (and `group/+server.ts`)

Started‑phase detection uses `kickoff_time <= NOW()` on the DB, which is fine
for clock skew, but only filters phases that have **any** match started; the
end‑user can still save other slots in the same phase **after** the kickoff has
passed. Example: once R32 game 1 starts, the whole `r32` phase is filtered out
of subsequent saves — but if `kickoff_time` is NULL on a match (e.g. seed not
yet populated kickoff times for the 2026 KO matches, which currently they
aren't — only group SQL seeds exist), the filter never triggers and users can
keep editing picks until the pool‑level `deadline_knockout` fires.

**Fix.** Add a NOT‑NULL invariant on `kickoff_time` for any match that should
be eligible for a per‑match deadline, or fall back to the pool‑level deadline
unconditionally when `kickoff_time IS NULL`.

### 2.4 — `live-scores.ts` fuzzy team name match (HIGH — Data)
**File:** `src/lib/server/live-scores.ts:152-161`

```js
WHERE (t1.name LIKE $1 ESCAPE '\\' AND t2.name LIKE $2 ESCAPE '\\')
  AND m.status != 'finished'
LIMIT 1
```

With substring matching and `LIMIT 1`, the wrong row can be picked when the
API returns a slightly different team name. Example: FIFA's *"Korea Republic"*
vs DB's *"South Korea"* — neither matches via LIKE, so the row is silently
skipped (treated as `skipped`, no error). The same query also matches *"Bosnia"*
against *"Bosnia and Herzegovina"* but would also match *"USA"* vs *"United
States"* — neither way, so result is dropped.

**Fix.** Build an explicit normalization table (`fifa_team_name` → `internal_id`)
or add a `fifa_team_name TEXT[]` column on `teams` for aliases.

### 2.5 — Admin can edit results without bounds check on `penalty_winner_id` (HIGH — Data)
**File:** `src/routes/api/admin/results/+server.ts:14-46`

`penalty_winner_id` is accepted from the body and written to `matches` without
validating that it equals `home_team_id` or `away_team_id` (or that the match
ended in a draw). An admin could submit `penalty_winner_id = 12345` for a
non‑draw match and bracket scoring will then incorrectly treat 12345 as the
match winner.

**Fix.**
```ts
if (penalty_winner_id !== null) {
  if (home_score !== away_score) {
    return json({ error: 'penalty_winner sólo en empates' }, { status: 400 });
  }
  if (penalty_winner_id !== match.home_team_id &&
      penalty_winner_id !== match.away_team_id) {
    return json({ error: 'penalty_winner_id no coincide con los equipos' }, { status: 400 });
  }
}
```

### 2.6 — `B5-3` cross‑phase consistency check is one‑sided (HIGH — Logic)
**File:** `src/routes/api/predictions/bracket/+server.ts:139-170`

If a user saves the final phase **without** also re‑sending SF, the check sees
`teamsInPrecedingPhase.size === 0` and skips validation entirely, allowing a
final pick whose team is not anywhere in SF. The autosave on the bracket page
posts ALL phases (so this is fine in practice), but any external caller (or a
future entry‑level UI) can bypass the rule.

**Fix.** Hydrate `teamsInPrecedingPhase` from the database when the payload omits
the preceding phase:

```ts
let preceding = picks[precedingPhase];
if (!preceding) {
  const { rows } = await query(
    'SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = $2',
    [prediction_id, precedingPhase]
  );
  preceding = Object.fromEntries(rows.map((r, i) => [i + 1, r.team_id]));
}
```

### 2.7 — Visual layout vs. wiring mismatch (HIGH — UX/Logic)
**File:** `src/routes/pool/[id]/bracket/+page.svelte:649-865`

Even before the wiring fix in 1.1, the desktop layout claims:

- Left wing shows `R16[0..3]` next to `R32[0..7]`.
- Right wing shows `R16[4..7]` next to `R32[8..15]`.

But with the current `R32_TO_R16`:

- `R16[5]` is drawn on the right (slice 4..8) yet pairs `R32[9]` + `R32[8]` —
  both of which are R32 cards drawn on the right wing — so visually it appears
  the right half is internally consistent, but the underlying matches are M85+M87
  which are not paired in FIFA.
- After fixing 1.1, the visual layout will need the slices and indices
  re‑checked: ensure each side of the bracket draws the R32 / R16 / QF / SF
  blocks that actually feed into its own SF and into the final.

**Fix.** Once the wiring numbers are corrected, walk through every `slice(...)`
in the desktop layout and confirm that R16 indices on each wing match the R32
indices on the same wing, and that QF indices feed into the SF on the same wing.

---

## 3. MEDIUM findings

### 3.1 — `hooks.server.ts`: session cleanup only runs on cache miss with no user (MEDIUM — Data)
**File:** `src/hooks.server.ts:33-35`

```ts
if (user) { event.locals.user = user; }
else {
  const now = Date.now();
  if (now - _lastClean > 60_000) { _lastClean = now; cleanSessions().catch(console.error); }
}
```

The cleanup is gated on the *user not being found*. If every request hits a
valid session, `cleanSessions()` never runs and expired session rows accumulate
indefinitely. Move the throttle outside the if/else so it runs at most once per
minute regardless.

### 3.2 — `getPool.id` view caches whole `pool/[id]` response keyed by pool only (MEDIUM — Data)
**File:** `src/routes/pool/[id]/+page.server.ts:128-187`

The cached blob `{ resultsPhases, resultsTeamCache, resultsGroupStandings }`
is keyed on `pool.id` but the matches table is global (every pool sees the
same matches/results data), so the cache key is OK. However the cache is read
inside the per‑user load function and *not* segmented from `userId`. That's
fine because the cached object only contains tournament‑wide data — but make
sure nothing leaks user‑specific data into it in a future refactor (no problem
today; flagging for the next change).

### 3.3 — `getUserPredictions(poolId, userId)` returns rows in indeterminate order (MEDIUM — Logic)
**File:** `src/lib/server/queries.ts:189-192`

```ts
const { rows } = await query('SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
```

No ORDER BY. The bracket and predict page rely on `predictions[0]` as the
"default" entry when no `?entry=` is passed. The "first" prediction varies
across page loads, surfacing different default entries to the user on refresh.

**Fix.** `ORDER BY created_at ASC, id ASC`.

### 3.4 — Login response sets cookie with `sameSite: 'lax'` only (MEDIUM — Security)
**File:** `src/routes/api/auth/[action]/+server.ts:64,83`

CSRF protection currently leans on `sameSite=lax` and POST‑only mutation
endpoints. SvelteKit's built‑in `csrf` protects against form‑action XSRF but
JSON endpoints (`/api/predictions/...`, `/api/admin/...`) are reachable from
cross‑origin JS via `fetch` with `credentials: 'include'`. `sameSite=lax` blocks
the cross‑site cookie on the fetch, so today it's mitigated — but be explicit:
add an `Origin`/`Referer` whitelist check on admin & mutation endpoints in case
the cookie policy is ever relaxed.

### 3.5 — `api/predictions/group/+server.ts` doesn't enforce position monotonicity (MEDIUM — Logic)
**File:** `src/routes/api/predictions/group/+server.ts:121-128`

The endpoint blocks duplicates within a group but allows `{ pos1: null, pos2: null, pos3: 12 }`.
Front‑end never sends this state, but the DB then ends up with a 3rd place but
no 1st/2nd. Bracket scoring's 3rd‑place lookup will still consider it. Add
"no gaps" validation: if `posN != null` then `pos1..posN-1` must also be set.

### 3.6 — `api/predictions/match-scores/+server.ts` clears `points_earned` on edit (MEDIUM — Logic)
**File:** `src/routes/api/predictions/match-scores/+server.ts:114-121`

```ts
ON CONFLICT(prediction_id, match_id) DO UPDATE SET
  home_score = $3, away_score = $4, points_earned = 0
```

If a user updates their prediction *after* a match's `points_earned` was
calculated, this resets the column to 0 and `calculateAllScores` is launched
asynchronously via `setImmediate`. Until that job finishes, the prediction's
`total_score` shows the still‑stale aggregate (now divergent from the
zeroed `points_earned`). Race window is small but visible in the UI. Either
recompute synchronously or include the zeroed delta in the response.

### 3.7 — Auto‑score recalculation isn't cancelled when a pool is deleted (MEDIUM — Reliability)
**File:** `src/routes/api/admin/sync-scores/+server.ts:24-35`

`setImmediate(async () => { for (poolId of poolIds) calculateAllScores(poolId) ... })`
captures pool IDs at request time. If a pool is deleted before the loop reaches
it, `calculateAllScores` writes nothing (advisory lock holds, but the query
runs), causing a benign error. Worse, the loop is sequential and unbounded:
with N=100 pools a sync can take minutes while the next sync also schedules
its own loop — concurrent loops fight over the per‑pool advisory lock.

**Fix.** Use a small worker pool (e.g. `p-limit(3)`) and check `is_active`
before each iteration.

### 3.8 — Bracket page deep‑clones state on every change (MEDIUM — Performance)
**File:** `src/routes/pool/[id]/bracket/+page.svelte:204-227`

```js
const teams = $derived.by(() => {
  void version;
  const t = {};
  for (const [k, v] of Object.entries(_teams)) { ... map ... }
  return t;
});
```

Two derived clones (`teams`, `explicitPicks`) run on every `bump()`, and
`autoSaveBracket()` is queued on every pick. On mobile this is noticeable.
Consider `$state` arrays instead of the version‑counter+clone workaround — the
recent fix (commit `bf3e846`) addresses a visual cascade lag but at the cost
of two O(matches) clones per click.

### 3.9 — Tiebreaker save UI shows "Guardado" on `r.ok` but DB write happens only when both inputs are non‑null (MEDIUM — UX)
**File:** `src/routes/pool/[id]/bracket/+page.svelte:358-373` and `api/predictions/tiebreaker/+server.ts:80-89`

If the user types `3` in *home* and nothing in *away*, the client doesn't POST
(early‑return on either null). If both are filled and then *away* is cleared,
the next save sends `(3, null)` which deletes the row server‑side — but the
toast still shows "Guardado". Distinguish update vs. delete in the response.

### 3.10 — Seed data: Group I has Senegal at FIFA rank 19, but real FIFA rank ≈ 19 may shift before tournament start (MEDIUM — Data)
**File:** `src/lib/server/seed.ts`

Ranks are hard‑coded. Periodic re‑seed or admin "refresh ranks" endpoint
recommended. Also two teams share rank 48 (Ivory Coast and Qatar) — not a bug
but a flag that the data should be refreshed once FIFA publishes its
pre‑tournament ranking.

Spot‑check of 48‑team / 12‑group composition vs. the Dec 5 2025 draw published
on the FIFA site: all 48 teams present, no duplicates across groups, exactly
four per group. Groups A–L matches the Wikipedia "2026 FIFA World Cup Group
Stage" article as of January 2026.

### 3.11 — `getPoolMembers` returns a row per entry (cartesian on multi‑entry pools) (MEDIUM — Data)
**File:** `src/lib/server/queries.ts:156-172`

```sql
LEFT JOIN predictions pr ON pr.pool_id = pm.pool_id AND pr.user_id = pm.user_id
```

In a pool with `allow_multiple_predictions = true`, every member becomes N
rows. The admin view (`pool/[id]/admin/+page.svelte`) likely iterates `members`
and shows each entry, but `stats.totalMembers = members.length` (admin page
server, line 38) then over‑counts members.

**Fix.** Either return one row per entry **and** compute member count from a
distinct subquery, or split into two queries (members + entries).

### 3.12 — `share_token` from `crypto.randomUUID()` ≈ 122 bits — fine, but invite_code is 16 base64url chars uppercased (≈ 80 bits) (MEDIUM — Security)
**File:** `src/lib/server/queries.ts:27-29`

`generateInviteCode()` truncates to 16 chars and uppercases. Uppercasing
collapses the base64url alphabet from 64 to ~38 distinct chars, dropping
entropy to ~84 bits. Still safe today, but if invite codes ever need to be
URL‑shareable and survive brute‑force enumeration scans on shared hosts,
either drop the `.toUpperCase()` (and treat the code as case‑sensitive) or
extend to 24 chars.

### 3.13 — `r32` "third place" picker doesn't persist `slot` of the selected team (MEDIUM — Logic)
**File:** `src/routes/pool/[id]/bracket/+page.svelte:103-122`

`pick3rd(mi, teamId)` writes only `match[1] = teamId` and toggles `_picks.r32[mi][1] = true`.
But the user is selecting *who plays in this R32 match as the 3rd‑place team*,
not *who wins it*. After they make the pick, the same logic that interprets
`_picks.r32[i][1] = true` as "team in slot 1 wins" kicks in (see line 245),
so the 3rd place opponent is implicitly treated as the **winner** of that R32
match. There's no separate flag for "team is in this slot" vs. "team won this
match". As a result, picking a 3rd‑place team auto‑promotes them through to
R16 with no second click, and the user can never assign the 3rd‑place team
without also predicting them to win.

**Fix.** Maintain a separate `_thirdSlots[mi]` map for "which 3rd‑place team
fills slot 1 here", independent from `_picks[mi][ti]` (the "winner" boolean).

---

## 4. LOW findings

### 4.1 — `bracket/+page.svelte` legend says "TBD" maps to "Clasificados de 3er puesto" but TBD also appears for placeholders before group predictions are filled. UI clarity issue.

### 4.2 — `pickTeam` uses the same animate‑bg setTimeout; if user rage‑taps the same button, `origBg` is overwritten between timers and the inline style permanently sticks.

### 4.3 — `flagEmoji` returns the white flag for any code whose length isn't 2/ENG/SCT; future codes like 'XK' (Kosovo) work, but multi‑char codes (none today) will silently white‑flag.

### 4.4 — `getUserPools` uses `ORDER BY p.created_at DESC` but admins may want most‑recent‑joined first; minor UX.

### 4.5 — `hooks.server.ts` `publicPaths` includes `'/api/auth'` which catches `/api/auth/change-password` — change‑password requires `locals.user`, so it self‑guards, but the public‑path list isn't an accurate description anymore.

### 4.6 — `pool/[id]/admin/+page.server.ts` reads "creator only" for admin; a global site admin (`is_admin = true`) cannot access pool admin pages. Compare with `api/admin/payment/+server.ts` line 22 which *does* allow the site admin. Inconsistent.

### 4.7 — `live-scores.ts` `FIFA_STAGE_MAP` IDs (`'285063'`…) are stubs. Verify before the tournament.

### 4.8 — `audit.ts` ignores write failures (`.catch(err => console.error(...))`). Acceptable but means an audit row can silently fail with no metric.

### 4.9 — `db.ts` Pool size `max: 10` for serverless Neon — likely OK, but no `application_name` is set; lower observability.

### 4.10 — `seed.ts` script calls `process.exit(1)` on failure but exits 0 on success — fine for npm scripts but lacks `process.exit(0)` for sanity.

### 4.11 — `tiebreaker_close` defaults to `9999` when no tiebreaker row exists; pools sorted by this can push entries without a tiebreaker last on identical scores, which may not be the desired tiebreak order.

### 4.12 — Numerous endpoints catch errors and log "Internal server error" without an error code; ops can't separate 5xx classes.

---

## 5. Reactivity / Svelte 5 specifics

### 5.1 — Bracket page mixes `$state`, `$derived`, and module‑level mutable `_teams`/`_picks` (LOW)

This is intentional — comments say "Store state in plain objects (not $state) — reactivity via version". The current approach works, but it's fragile and easy to break: any call site that mutates `_teams` without then calling `bump()` will desync the UI. Consider migrating to deep `$state`(`$state.raw` for performance) once the cascade‑lag root cause is resolved.

### 5.2 — `selections = JSON.parse(JSON.stringify(selectionsInit))` runs whenever `selectionsInit` changes (predict page, line 63) — fine, but if the user is mid‑edit and the server load() re‑runs (e.g. on entry switch), pending edits are lost without warning.

### 5.3 — `pool/[id]/predict/+page.svelte` uses `$derived` for `GROUP_NAMES` whose default ordering is `'ABCDEFGHIJKL'.split('')` — matches the seed.

### 5.4 — `pool/[id]/bracket/+page.svelte` `$effect` initializer (line 231) sets `initialized = true` outside `untrack`. If `data` triggers the effect to re‑run (e.g. soft navigation between entries via the same component instance), `initState()` won't re‑run because `initialized` stays true. Currently `switchEntry` does a full `window.location.href` reload, so this is masked — but if SPA navigation is enabled later, bracket state will go stale.

---

## 6. Bracket wiring summary (Round‑by‑round vs. FIFA 2026)

| Round | App match labels | Status | Notes |
|-------|------------------|--------|-------|
| Group stage | 12 groups × 4 teams | ✅ Correct | Seed matches Dec 5 2025 draw |
| R32 (R32_MAP) | 16 matchups | ✅ Correct | Each pairing matches a real FIFA R32 fixture |
| R16 (R32_TO_R16 / R16_LABELS) | 8 matchups | ❌ Broken on right half | R16[5..7] do not match the FIFA bracket — see §1.1 |
| QF (QF_LABELS) | 4 matchups | ⚠ Needs verification after R16 fix | QF currently pairs M90/M93 (cross‑half), M89/M87+M85, etc. — verify against the FIFA QF table once R16 is fixed |
| SF (SF_LABELS) | 2 matchups | ⚠ Inherits QF assumption | After QF is correctly wired this is fine |
| Final / 3rd | 1 each | ✅ Correct | Only feeds from SF winners / losers |

---

## 7. Scoring correctness

`src/lib/server/scoring.ts` was read end‑to‑end. Findings:

- **Group sorting tiebreaker doesn't include head‑to‑head** (line 67 TODO already acknowledges this — MEDIUM)
- **`calculateBracketScores` correctly skips draws without `penalty_winner_id`** ✓
- **`knockout_winner` is added on top of `knockout_final` only for the slot containing the actual winner** ✓
- **Bracket scoring is idempotent** thanks to the bulk unnest UPDATE — re‑running cannot double‑count ✓
- **Advisory lock** in `calculateAllScores` correctly prevents concurrent re‑scoring per pool ✓

No scoring logic bug found *given the wiring*. Once §1.1 is fixed, scoring will
operate on correctly wired picks and the totals will recover.

---

## 8. Verification of seed data

All 48 teams present, exactly 4 per group, group letters A–L. Spot‑check
against December 5 2025 FIFA draw: matches official groups for the verified
slots. Notes:

- 'Czech Republic' uses ISO code `CZ` (correct; future change to `CZE` would
  require updating `flagEmoji`).
- 'Curaçao' flag code `CW` is correct (ISO 3166-1 alpha-2).
- 'Scotland' / 'England' use custom three‑letter codes `SCT` / `ENG` for the
  emoji‑flag helper.
- Two teams share FIFA rank 48 (Ivory Coast, Qatar) — see §3.10.

---

## 9. Recommended fix order

1. **§1.1 bracket wiring** — touches scoring legitimacy for every prediction.
2. **§1.2 IDOR on pool routes** — silent privacy leak.
3. **§2.5 admin `penalty_winner_id` validation** — easy to weaponize accidentally.
4. **§2.2 leaderboard ORDER BY** — wrong tiebreaker today.
5. **§2.1 change‑password rate limit** — defence in depth.
6. **§3.13 R32 3rd‑place slot logic** — UX confusion + double‑counted pick.
7. Remaining MEDIUMs / LOWs.

---

*Audit performed against the working tree at HEAD (commit `bf3e846`) on
2026-05-28.*
