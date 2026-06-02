# AUDIT-OPUS-FULL-6 — World Cup Pool Comprehensive Audit
Date: 2026-05-28
Auditor: Claude Opus 4.7

Scope: Full review of `src/` (hooks, server lib, all API routes, all page-server loaders, all Svelte components).
Findings prioritized by severity (CRITICAL > HIGH > MEDIUM > LOW). Each finding cites file:line.

---

## §1. SECURITY

### §1.1 — CRITICAL — Cached session bypasses `is_admin` revocation
**File**: `src/hooks.server.ts:78-98` (in conjunction with `src/lib/server/cache.ts:160-177`)
**Description**: `getCachedSession(token)` returns the full user object (including `is_admin`) for 60s without re-validating against the DB. If an admin demotes a user, or a user's account is deleted/suspended, the demoted/deleted user retains their cached privileges for up to 60s. Many admin-gated endpoints (`/api/admin/recalculate`, `/api/admin/payment`, `/api/admin/results`, `/api/admin/reset-password`, etc.) read `locals.user.is_admin` directly — they will accept the stale value.
**Impact**: Privilege revocation race window: ex-admin can still perform admin actions for up to 60 seconds after demotion. Same for deleted users and password resets (see §9.2/§9.3).
**Fix**: Re-fetch `is_admin` from DB on each admin-gated request, or expose an `invalidateCachedSessionByUserId(userId)` helper and call it from the admin-promotion/demotion, change-password, and reset-password endpoints.
```ts
// cache.ts — add
export function invalidateCachedSessionByUserId(userId: number): void {
  for (const [token, e] of _sessionCache) {
    if (e.data?.id === userId) _sessionCache.delete(token);
  }
}
// reset-password/+server.ts — after DELETE FROM sessions
invalidateCachedSessionByUserId(targetUserId);
```

### §1.2 — CRITICAL — `/api/admin/reset-password` does not invalidate session cache
**File**: `src/routes/api/admin/reset-password/+server.ts:24-26`
**Description**: After resetting password, the route runs `DELETE FROM sessions WHERE user_id = ...` but never invalidates `_sessionCache`. Existing browser sessions for the affected user remain "logged in" through the cached entry until the 60s TTL expires, even though their DB row no longer exists.
**Impact**: Compromised user whose password was reset by admin remains authenticated for up to 60 seconds. The session cookie still appears valid because the cache lookup hits before the DB lookup.
**Fix**:
```ts
// After resetting password:
const { rows: tokens } = await query(
  'SELECT s.token FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = $1',
  [username]
);
// But sessions were already deleted — instead capture them first:
const { rows: tokens } = await query(
  `SELECT s.token FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.username = $1`,
  [username]
);
// ...delete sessions...
for (const { token } of tokens) invalidateCachedSession(token);
```
(or use the `invalidateCachedSessionByUserId` helper from §1.1.)

### §1.3 — CRITICAL — `change-password` does not invalidate cached "other" sessions
**File**: `src/routes/api/auth/change-password/+server.ts:24-26`
**Description**: After the user changes their password, the route deletes all OTHER sessions in DB but the in-process `_sessionCache` still contains those tokens. An attacker holding a stolen session cookie continues to authenticate against the cache for up to 60s after the legitimate user's defensive password change.
**Impact**: Defeats the security purpose of "log out other devices on password change."
**Fix**: Iterate cached tokens and `invalidateCachedSession(token)` for any entry whose `data.id === locals.user.id` and whose token is not the current one.

### §1.4 — HIGH — `/api/predictions/group` crashes on missing `groups` field (DoS-lite)
**File**: `src/routes/api/predictions/group/+server.ts:64-72`
**Description**: The handler destructures `rawGroups` and immediately calls `Object.entries(rawGroups)` before the `if (!prediction_id || !groups)` null-check at line 74. If a client posts `{ "prediction_id": 1 }` with no `groups` key, `Object.entries(undefined)` throws TypeError before reaching the guard. The error is not wrapped in try/catch and returns a 500 with a stack trace in the error response (no `errCode` wrapper here).
**Impact**: Unauthenticated 500 responses; minor info leak (Node stack), nuisance crash, audit-log noise.
**Fix**:
```ts
if (!rawGroups || typeof rawGroups !== 'object') {
  return json({ error: 'Falta prediction_id o grupos' }, { status: 400 });
}
const groups: ... = {};
for (const [k, v] of Object.entries(rawGroups)) { groups[k.toUpperCase()] = v; }
```

### §1.5 — HIGH — Unsafe destructuring in `/api/auth/[action]` register handler
**File**: `src/routes/api/auth/[action]/+server.ts:51-53`
**Description**: `body` is typed as `unknown` but the handler does `const { username, password, display_name } = body;` with no guard that `body` is a non-null object. Posting `null` as the JSON body (`Content-Type: application/json` with body `null`) throws `Cannot destructure property 'username' of 'null'`. No try/catch wraps it; SvelteKit will return 500.
**Impact**: Trivial 500 attack surface, repeated crashes pollute logs.
**Fix**:
```ts
if (!body || typeof body !== 'object') {
  return json({ error: 'Cuerpo inválido' }, { status: 400 });
}
const { username, password, display_name } = body as Record<string, unknown>;
```
Apply the same to the `login` branch at line 80.

### §1.6 — HIGH — Tiebreaker accepts partial input but silently treats as delete
**File**: `src/routes/api/predictions/tiebreaker/+server.ts:51-97`
**Description**: Validation `if (home_score !== null && away_score !== null)` checks the range only when BOTH are non-null. Send `{ home_score: 2, away_score: null }` and validation is skipped; then the save branch (`if (home_score !== null && away_score !== null)` at line 87) is false, so the row is DELETED instead. User intending to save a partial value gets silent data loss.
**Impact**: Silent data loss; misleading "saved" toast from the client.
**Fix**: Reject mixed-null state before deciding save vs delete:
```ts
if ((home_score === null) !== (away_score === null)) {
  return json({ error: 'Debes indicar ambos goles o ninguno' }, { status: 400 });
}
```

### §1.7 — HIGH — `/api/admin/scoring` POST accepts pool-creator only, not site-admin
**File**: `src/routes/api/admin/scoring/+server.ts:21-25, 49-54`
**Description**: Both GET and POST check only `pool.created_by === locals.user.id` and return 403 otherwise. Inconsistent with `/api/admin/payment` (`§4.6` per existing comments — creator OR site admin). A site admin cannot moderate/repair scoring rules of a misconfigured pool.
**Impact**: Operational pain; site admin cannot intervene without DB access.
**Fix**: Mirror payment's check:
```ts
if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
  return json({ error: 'Prohibido' }, { status: 403 });
}
```

### §1.8 — HIGH — `tiebreaker` POST: missing JSON-parse try/catch
**File**: `src/routes/api/predictions/tiebreaker/+server.ts:41`
**Description**: `const body = await request.json();` is not wrapped. Invalid JSON throws synchronously inside the async handler → 500 with no `errCode`. Other prediction endpoints (`bracket`, `group`, `match-scores`) wrap parsing — this one is inconsistent.
**Impact**: Trivial 500 attack; inconsistent error shape.
**Fix**:
```ts
let body: unknown;
try { body = await request.json(); }
catch { return json({ error: 'Invalid JSON body' }, { status: 400 }); }
```

### §1.9 — MEDIUM — `/api/admin/payment` POST: no JSON-parse guard + no boolean validation
**File**: `src/routes/api/admin/payment/+server.ts:12-14`
**Description**: `await request.json()` not wrapped (→ 500 on invalid JSON). `has_paid` is `as { has_paid: boolean }` cast but never type-checked at runtime — passing `has_paid: "no"` coerces to `true` (truthy string). Also, when `entry_id` is provided but the entry doesn't exist or belongs to a different pool, the UPDATE silently matches 0 rows and the endpoint returns `{ok: true}` — should 404.
**Impact**: Silent state-changing requests; confusing UI feedback.
**Fix**: Wrap parse; coerce `has_paid` to strict boolean (`has_paid === true`); check rowCount and 404 if zero.

### §1.10 — MEDIUM — `/api/admin/reset-password` does not log to audit_log
**File**: `src/routes/api/admin/reset-password/+server.ts`
**Description**: Resetting another user's password is the highest-impact admin action and produces no audit trail. Compare `/api/admin/recalculate` which calls `logAudit('recalculate', ...)`.
**Impact**: No forensic record of who reset whose password.
**Fix**:
```ts
await logAudit('reset_password', locals.user.id, 'user', userId, null, { username });
```
(also resolve the username → userId for the audit row)

### §1.11 — MEDIUM — `cleanSessions()` rate-limit timer is process-local
**File**: `src/hooks.server.ts:20, 103-107`
**Description**: `_lastClean` is per-process. With multiple workers (clustering) each cleans independently → harmless duplication. Acceptable on single instance but worth documenting given the cache module already enforces single-instance assumption.

### §1.12 — MEDIUM — Origin-check normalization treats LAN as same-origin
**File**: `src/hooks.server.ts:46-58`
**Description**: The CSRF defence collapses any RFC1918 private IP to `localhost`. That is fine for dev convenience, but in a production deployment behind a reverse proxy where the app sees the proxy IP as `10.x.x.x`, an attacker who can place a request inside the same subnet (compromised internal host, malicious browser extension on a corporate LAN) could spoof the Origin header to a `10.x.x.x` URL and bypass the cross-origin check.
**Impact**: Defence-in-depth weakened. Primary defence (sameSite=lax cookie) still holds, so impact is bounded.
**Fix**: Gate the LAN collapse on `NODE_ENV !== 'production'`, or only collapse loopback hostnames in production.

### §1.13 — LOW — `/api/admin/backup` PUT path-traversal check is incomplete
**File**: `src/routes/api/admin/backup/+server.ts:51`
**Description**: Filters `/`, `\`, `..` but does not catch URL-encoded variants (`%2f`, `%2e%2e`), null bytes, or absolute path indicators on Windows (`C:`). Currently `restoreBackup()` always throws so this is theoretical, but if someone activates Neon backups via this endpoint, the validation is insufficient.
**Fix**: Allowlist `^[A-Za-z0-9_\-]+$` only.

### §1.14 — LOW — Invite-code uniqueness not enforced in handler
**File**: `src/lib/server/queries.ts:32-34, 74-105` and `src/routes/api/pools/join/+server.ts:15`
**Description**: `generateInviteCode()` returns a 24-char base64url-uppercase string but `createPool()` inserts without retry-on-collision. The DB column is presumably UNIQUE (would throw 23505), but the caller does not retry. Also, the join handler accepts 16-char codes (`/^[A-Za-z0-9_-]{16}$/`) while the generator produces 24-char codes — a mismatch that means newly-generated codes can never be joined through the strict validator.
**Impact**: After this commit, any new pool's invite code is 24 chars but join rejects them as malformed → users can never join via the typed-code path. SHARE-LINK path (`/s/[token]`) still works.
**Fix**: Make the validator match the generator: `/^[A-Z0-9_-]{24}$/`. Or change the generator to 16 chars (less entropy, but consistent with prior format).

---

## §2. DATA INTEGRITY

### §2.1 — HIGH — `calculateAllScores` reads `total_score` while sub-UPDATEs are in flight (no advisory lock around the rollup)
**File**: `src/lib/server/scoring.ts:300-362`
**Description**: The `pg_try_advisory_xact_lock` serializes within the same transaction, but the final rollup `UPDATE predictions SET total_score = sub.total` aggregates `points_earned` from group/bracket/match prediction tables that were just updated *inside this transaction*. That's correct read-your-own-writes in PostgreSQL. ✅ no bug here. Documented as verified.

### §2.2 — HIGH — Bracket scoring awards points for duplicate team picks
**File**: `src/lib/server/scoring.ts:182-204` and `src/routes/api/predictions/bracket/+server.ts` (entire POST)
**Description**: The bracket POST handler does NOT validate that the same `team_id` appears at most once within a phase. The UI prevents it for legit users, but a crafted payload can pick the same team in N slots. The scoring UPDATE awards `pts` to EVERY row whose `team_id` matches a winner — so a malicious user who picks the eventual R32 winner in all 16 R32 slots gets 16× the per-pick points.
**Impact**: Trivially game the leaderboard.
**Fix** (in `/api/predictions/bracket` POST after team-ID validation):
```ts
for (const [phase, slots] of Object.entries(picks)) {
  const seen = new Set<number>();
  for (const teamId of Object.values(slots)) {
    if (teamId === null) continue;
    if (seen.has(teamId)) {
      return json({ error: `Equipo repetido en fase ${phase}` }, { status: 400 });
    }
    seen.add(teamId);
  }
}
```

### §2.3 — HIGH — Group-tiebreaker doesn't honour head-to-head (per existing TODO)
**File**: `src/lib/server/scoring.ts:67-75`
**Description**: Already flagged in code (`TODO B6-6`). Real FIFA tiebreaker is points → goal difference → goals for → **head-to-head** → fair-play → drawing of lots. The current implementation stops at GF and uses no H2H disambiguation. For groups that finish tied in points and GD/GF, the "actual" standings the scorer derives will silently mis-rank teams, awarding/denying user `group_position` points incorrectly.
**Impact**: User's correct prediction can be marked wrong (and vice versa) in close groups.
**Fix**: Implement H2H prior to GD/GF (see implementation guidance in existing TODO comment).

### §2.4 — HIGH — `live-scores.syncScores` coerces missing scores to 0-0
**File**: `src/lib/server/live-scores.ts:67-68, 117-118`
**Description**: `fixture.goals.home ?? 0` and `fixture.goals.away ?? 0`. If the upstream API returns null/missing goals for a "finished" match (which happens — abandoned, walkover, data not yet ingested), this writes a real 0-0 to the DB and triggers scoring. Compare `/api/admin/results` which explicitly rejects null scores at validation time.
**Impact**: Silent 0-0 result for matches with unknown scores → wrong scoring for every user pool.
**Fix**:
```ts
const homeScore = fixture.goals.home;
const awayScore = fixture.goals.away;
if (homeScore == null || awayScore == null) continue; // skip incomplete
matches.push({ ..., home_score: homeScore, away_score: awayScore, ... });
```

### §2.5 — HIGH — `live-scores.syncScores` matches by name only when status is non-finished, but `fifa_id` match path doesn't apply the same guard
**File**: `src/lib/server/live-scores.ts:155-216`
**Description**: When matched by `fifa_id`, `dbMatch` may already be `status='finished'` — but the UPDATE then runs `WHERE id = $3 AND status != 'finished'` (line 205). So the UPDATE is silently no-op for already-finished matches (rowCount=0 → counted as "skipped"). OK. The bug is upstream: a single FIFA sync that returns the same match twice will double-count. Also, the FIFA stage-ID map is stubbed — every imported phase becomes `'unknown'`, which is not a valid value in `matches.phase` and may FK-fail or break scoring queries that filter by phase.
**Impact**: Phase coercion to `'unknown'` will silently exclude knockout scoring entirely once a real FIFA sync runs.
**Fix**: Replace the stub IDs before tournament start (per existing comment in `FIFA_STAGE_MAP`), AND guard syncScores to refuse imports with `phase === 'unknown'`:
```ts
if (m.phase === 'unknown') { skipped++; continue; }
```

### §2.6 — HIGH — Admin `results` recalculates pools sequentially (`for…await` over all active pools)
**File**: `src/routes/api/admin/results/+server.ts:73-86`
**Description**: After updating a single match, the handler loops `for (const poolId of poolIds) await calculateAllScores(poolId)`. With N pools each taking ~200ms-1s, a manual result entry could block the request for many seconds. Compare `/api/admin/sync-scores` which uses `runWithConcurrency`.
**Impact**: Admin UI hangs/times-out; HTTP 504 from proxy; potential lost recalc.
**Fix**: Use `runWithConcurrency` like sync-scores:
```ts
await runWithConcurrency(poolIds, 3, async (poolId) => {
  try { await calculateAllScores(poolId); invalidateCachedPoolLeaderboard(poolId); invalidateCachedPoolResults(poolId); }
  catch (e) { console.error('[score] admin/results pool', poolId, e); }
});
```

### §2.7 — HIGH — `/api/admin/recalculate` does NOT invalidate caches after success
**File**: `src/routes/api/admin/recalculate/+server.ts:22-24`
**Description**: After `await calculateAllScores(pool_id)`, the handler does not call `invalidateCachedPoolLeaderboard / invalidateCachedPoolResults / invalidateGlobalLeaderboard`. The admin-facing "recalculate" button appears to have done nothing for up to 30-60s because the leaderboard view stays stale.
**Impact**: Confusing admin UX; perceived bug; users see old totals.
**Fix**:
```ts
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
// after calculateAllScores:
invalidateCachedPoolLeaderboard(pool_id);
invalidateCachedPoolResults(pool_id);
invalidateGlobalLeaderboard();
```

### §2.8 — MEDIUM — `match-scores` validation rejects entire batch on per-match kickoff violation
**File**: `src/routes/api/predictions/match-scores/+server.ts:60-68`
**Description**: If ANY match in the payload has already started, the endpoint returns 400 with `Algunos partidos ya comenzaron` and drops all the user's other in-flight changes. Compare `/api/predictions/group` (line 105-121) and `/api/predictions/bracket` (line 113-131) which silently FILTER out started groups/phases and accept the rest. Inconsistent UX — autosave on the predict page can completely fail because of one kickoff.
**Impact**: User loses unsaved knockout-score predictions if even one group match just kicked off.
**Fix**: Mirror the group/bracket pattern — drop started match IDs from `scores` and continue.

### §2.9 — MEDIUM — `/api/admin/results` reschedules scoring with stale `is_active = true` check inside the loop
**File**: `src/routes/api/admin/results/+server.ts:73-84`
**Description**: Pools are read with `SELECT id FROM pools WHERE is_active = true` once, then iterated. If a pool is deactivated mid-loop it's still scored (acceptable race). The `sync-scores` endpoint re-checks per pool (`stillActive`) before scoring — `results` does not. Minor consistency.

### §2.10 — MEDIUM — `migrate.ts` claims to read both `drizzle/migrations` and `src/lib/server/migrations` but only reads the first
**File**: `src/lib/server/migrate.ts:6-9, 48-52`
**Description**: Comment promises two paths; code reads only `drizzle/migrations`. Future migrations placed under `src/lib/server/migrations/*.sql` are silently skipped.
**Fix**: Either implement the second path, or delete the misleading comment.

### §2.11 — MEDIUM — `/api/predictions/bracket` does NOT trigger rescoring on save
**File**: `src/routes/api/predictions/bracket/+server.ts:240-243`
**Description**: After a successful bracket UPSERT/DELETE, the endpoint returns `{ok:true}` without calling `calculateAllScores`. Compare `/api/predictions/match-scores:140-154` which does. So a user who updates a R16 pick after a R16 match finishes won't see their points update until the next admin `sync-scores` or `recalculate`.
**Impact**: Stale `total_score` until next score sync; UX confusion.
**Fix**: Trigger inline rescore (or at least invalidate caches) on bracket save once at least one knockout match is `finished`.

### §2.12 — MEDIUM — `live-scores.syncScores` per-match DB roundtrips
**File**: `src/lib/server/live-scores.ts:152-219`
**Description**: One SELECT and one UPDATE per match, awaited serially. For ~104 World Cup matches that's >200 DB roundtrips on every sync. Acceptable today (sync is rare) but the function is also called by `/api/admin/fifa-sync` and any cron. Consider batching with a temp table + JOIN.

---

## §3. API DESIGN

### §3.1 — HIGH — Several admin POSTs swallow `request.json()` exceptions as 500
**Files**: `src/routes/api/admin/scoring/+server.ts:39`, `…/admin/pool-settings/+server.ts:10`, `…/admin/pool-creators/+server.ts:14, 34`, `…/admin/sync-scores/+server.ts` (POST does not read body), `…/admin/settings/+server.ts:13`, `…/admin/payment/+server.ts:12`, `…/admin/reset-password/+server.ts:9`, `…/admin/recalculate/+server.ts:12`, `…/admin/fifa-sync/+server.ts` (no body), `…/admin/backup/+server.ts:14, 47`
**Description**: None of these admin POSTs wrap `request.json()` — invalid bodies trigger a generic 500 instead of 400. The auth/login/register and predictions endpoints wrap it properly.
**Impact**: Inconsistent error shape; ops log noise; harder debugging.
**Fix**: One reusable helper:
```ts
async function parseJson(req: Request) {
  try { return await req.json(); }
  catch { return null; }
}
const body = await parseJson(request);
if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });
```

### §3.2 — HIGH — `/api/admin/payment` allows `entry_id` from a different pool to no-op silently
**File**: `src/routes/api/admin/payment/+server.ts:32-39`
**Description**: SELECT/UPDATE both scope to `id = entry_id AND pool_id = pool_id`, so cross-pool tampering returns rowCount=0 but `{ok:true}`. The endpoint should 404 to surface client bugs (and to make automated IDOR-probes detectable).
**Fix**: Check rowCount; 404 if zero.

### §3.3 — MEDIUM — `/api/predictions/match-scores` accepts non-integer `matchId` keys
**File**: `src/routes/api/predictions/match-scores/+server.ts:59, 111-128`
**Description**: `Object.keys(scores).map(Number)` happily produces `NaN` for non-numeric keys; the started-match check still passes (NaN matches nothing); then `Number(matchIdStr)` again in the loop produces NaN; INSERT with `match_id = NaN` falls through pg as `NULL` and FK-fails (good) but emits a server error instead of a clean 400.
**Fix**: Validate each key is a positive integer up-front:
```ts
for (const k of Object.keys(scores)) {
  const n = Number(k);
  if (!Number.isInteger(n) || n < 1) return json({ error: 'match id inválido' }, { status: 400 });
}
```

### §3.4 — MEDIUM — `/api/auth/[action]` register: `display_name.length > 50` check skipped when display_name is the empty string but `username.length > 50` is not even checked
**File**: `src/routes/api/auth/[action]/+server.ts:56-66`
**Description**: Length cap on username (20) is checked. Display name cap (50) only checked when truthy. Both correct. But the fallback `display_name || username` (line 66) means an empty display_name becomes the username, even if username > 50 is invalid (n/a here since username is ≤20). OK on length; flag for record.

### §3.5 — MEDIUM — `/api/predictions/bracket` `totalPicks > 64` allows the inclusive boundary but the actual data model permits 64 (32+16+8+4+2+2)
**File**: `src/routes/api/predictions/bracket/+server.ts:78-80`
**Description**: Boundary check is correct (64 allowed, 65 rejected). Documenting for completeness — no bug.

### §3.6 — MEDIUM — `/api/predictions/group` `> 32` group cap is far larger than the 12 real groups
**File**: `src/routes/api/predictions/group/+server.ts:78-80`
**Description**: Lax limit doesn't reject obvious abuse (e.g. 31 garbage group names). Subsequent `VALID_GROUPS` check filters, so effectively a no-op for valid traffic. Lowering to 12 makes the intent clear.

### §3.7 — MEDIUM — `/api/admin/fifa-sync` doesn't honor `runWithConcurrency`
**File**: `src/routes/api/admin/fifa-sync/+server.ts:24-30`
**Description**: Serial `for (const p of pools) await calculateAllScores(p.id)`. Same problem as §2.6.
**Fix**: Reuse `runWithConcurrency` helper from sync-scores.

### §3.8 — LOW — `/api/admin/settings` validation: `if (!key || !value)` blocks legitimate empty values
**File**: `src/routes/api/admin/settings/+server.ts:14`
**Description**: A site_settings key may legitimately be set to an empty string. The current guard rejects that. Currently no setting needs empty values, but worth flagging.

---

## §4. FRONTEND / SVELTE 5

### §4.1 — HIGH — `predict/+page.svelte` matchScores reset on every data prop change can lose unsaved input
**File**: `src/routes/pool/[id]/predict/+page.svelte:285-286`
**Description**: `let matchScores = $state({});` and `$effect(() => { matchScores = JSON.parse(JSON.stringify(matchScoresInit)); });` will overwrite the user's locally edited state any time `data.existingMatchPreds` changes (e.g. on a soft navigation/invalidateAll triggered by a sibling component). Unlike `selections`, there's no `_activeEdits` guard.
**Impact**: User types a score, navigation invalidation runs, user loses unsaved input.
**Fix**: Mirror the `_activeEdits` pattern from `selections` — only overwrite per-match entries the user is not currently editing, or debounce assignment to the first effect tick.

### §4.2 — HIGH — `bracket/+page.svelte` `switchEntry` does a full page reload
**File**: `src/routes/pool/[id]/bracket/+page.svelte:552-557, 572`
**Description**: `window.location.href = ...` instead of SvelteKit `goto(...)`. Discards the carefully-built `_teams` / `_picks` state. The auto-save just before navigation may not flush in time → switching entries can silently lose the last-edit change.
**Impact**: Data loss on entry switch; flashes white.
**Fix**: Use `goto` with `invalidateAll: true`, and `await saveBracket()` first to flush.

### §4.3 — MEDIUM — `predict/+page.svelte` `saveMatchScores` swallows fetch errors
**File**: `src/routes/pool/[id]/predict/+page.svelte:317-321`
**Description**: `catch (e) { console.error(e); }` — no toast, no `matchSaved=false` retention. User believes save worked. Should call `showToast('⚠️ …')` like `savePredictions` does.

### §4.4 — MEDIUM — `bracket/+page.svelte` `saveError` state is set but never rendered
**File**: `src/routes/pool/[id]/bracket/+page.svelte:477, 547`
**Description**: `let saveError = $state(null);` and `saveError = 'Error al guardar';` but no template binding for it. User sees no error UI when bracket save fails.
**Fix**: Either render it (`{#if saveError}<span class="…">{saveError}</span>{/if}`) or call `showToast('⚠️ '+...)`.

### §4.5 — MEDIUM — `join/[code]/+page.svelte` double-submit on hydration race
**File**: `src/routes/join/[code]/+page.svelte:34-58`
**Description**: `onMount` fires once on the client. The `handleSubmit` form is also wired for manual fetch. The auto-join always runs; on success it `window.location.href`-redirects, but if the user clicks the manual button during the in-flight auto-join, both POST `/api/pools/join`. The server returns `Ya estás en esta quiniela` (409) on duplicate join, so impact is bounded — but the user sees an error flash for what was actually success.
**Fix**: Track `joining` flag; disable both paths once one is in flight; on 409 success-redirect instead of error.

### §4.6 — MEDIUM — `+layout.svelte` 1-second `setInterval` for countdown that never sleeps
**File**: `src/routes/+layout.svelte:38-53`
**Description**: `setInterval(update, 1000)` runs on every page, every second, forever. Acceptable on desktop but contributes to mobile battery drain. Halt the interval once `diff <= 0`. Currently it correctly returns early but the interval keeps firing (just bails immediately). Cheap micro-fix.
**Fix**: `if (diff <= 0) { clearInterval(iv); return; }` inside `update`.

### §4.7 — MEDIUM — `predict/+page.svelte` race on first-paint: `JSON.parse(JSON.stringify(selectionsInit))` runs once but `selectionsInit` is `$derived`
**File**: `src/routes/pool/[id]/predict/+page.svelte:50-76`
**Description**: `let selections = $state(JSON.parse(JSON.stringify(selectionsInit)));` — initial value is computed before `$derived` first runs in some Svelte 5 ordering scenarios. The follow-up `$effect` overwrites with `selectionsInit` on every change. Pattern works but is fragile; the existing `_activeEdits.has(group)` guard saves it.

### §4.8 — LOW — `bracket/+page.svelte` `R16_TO_QF` is local to `recascade()` — same magic array also documented in QF labels at top-level
**File**: `src/routes/pool/[id]/bracket/+page.svelte:313, 75-80`
**Description**: The R16→QF mapping is hand-coded in two places (the QF_LABELS string AND the R16_TO_QF index array). Risk of drift if one is updated without the other.
**Fix**: Derive one from the other, or extract to a `const R16_TO_QF` at the top.

### §4.9 — LOW — `+layout.svelte` `stagger()` runs in onMount AND in $effect on $page change — duplicated work
**File**: `src/routes/+layout.svelte:92-100`

### §4.10 — LOW — `PullToRefresh.svelte` ignores `containerEl` binding
**File**: `src/lib/components/PullToRefresh.svelte:7, 38`
**Description**: `let containerEl: HTMLElement | null = null;` and `bind:this={containerEl}` but never read. Dead state.

---

## §5. DOMAIN LOGIC — Tournament / Bracket

### §5.1 — HIGH — `bracket/+page.svelte` `_thirdSlots` initialization race
**File**: `src/routes/pool/[id]/bracket/+page.svelte:132-135, 226-227`
**Description**: `_thirdSlots` is declared as a plain `let _thirdSlots = {}` (not `$state`). In `initState()` line 226: `_thirdSlots = _thirdSlots ?? {}; _thirdSlots[mi] = ...`. Mutations to the plain object don't trigger reactivity; the `bump()` at line 285 covers it for the derived `version` counter. OK for display, but switching entries without a full reload (see §4.2) leaves stale entries in `_thirdSlots` from the previous prediction.
**Impact**: 3rd-place picker shows the previously-loaded entry's selection on entry switch.
**Fix**: Reset `_thirdSlots = {}` inside `initState()` BEFORE the loop.

### §5.2 — HIGH — `bracket/+page.svelte` `getGroupTeam` returns `null` for missing group prediction, breaking R32 occupant for wildcards
**File**: `src/routes/pool/[id]/bracket/+page.svelte:183-192, 209-216`
**Description**: When a user hasn't predicted Group X yet, `getGroupTeam('X', 1)` returns `null`, so all the R32 matches that pull from that group show TBD. Behaves correctly. However, the cascading `recascade()` then writes `null` into `_teams.r32[i][0]`, which invalidates any explicit R16+ pick the user made earlier. Specifically: at line 304, `if (_picks.r16[i][j] && _teams.r16[i][j] !== winner)` — if `winner` becomes null because R32 was wiped, the explicit R16 pick is cleared.
**Impact**: Editing group predictions can blow away knockout picks the user already made. Documented as the intended behaviour, but worth a confirm prompt.

### §5.3 — HIGH — Bracket scoring rewards "third_place" pick under same key as 3rd-match winner — but the scoring code key is `third_place` for the 3rd phase, NOT `knockout_3rd`
**File**: `src/lib/server/scoring.ts:185-191`
**Description**: `const ruleKey = bp.phase === '3rd' ? 'third_place' : 'knockout_' + bp.phase;`. The default rules dict has `third_place: 6`, OK. But the rule key for phases is `knockout_r32 / r16 / qf / sf / final / winner` per `DEFAULT_SCORING_RULES`. Confirmed consistent.

### §5.4 — HIGH — `R16_TO_QF` mapping comment claims FIFA-correct, but the SF→Final mapping is naïve "sequential pair-of-two"
**File**: `src/routes/pool/[id]/bracket/+page.svelte:324-339`
**Description**: After R16→QF uses a hand-tuned permutation, QF→SF and SF→Final are pair-of-two: `winner = getWinner(from, i*2 + j)`. FIFA WC 2026 SF: SF1 = QF1∪QF2, SF2 = QF3∪QF4 — matches the naive mapping ONLY because the QF order was hand-permuted to make it work. The intent is buried — any future change to the QF index order will silently mis-bracket SF.
**Fix**: Make the mapping explicit and unit-tested (e.g. `QF_TO_SF = [0,1,2,3]`), mirroring `R16_TO_QF`.

### §5.5 — MEDIUM — `THIRD_GROUP_MAP` and `R32_MAP` wildcard slot indexes are coupled implicitly
**File**: `src/routes/pool/[id]/bracket/+page.svelte:91-100, 13-34`
**Description**: A wildcard match's index in `R32_MAP` is determined by ordering; `THIRD_GROUP_MAP` keys must match. If you ever reorder `R32_MAP`, the third-place teams will feed the wrong cross. Add an integration test.

### §5.6 — MEDIUM — `R32_MAP` group letter `'?'` magic value
**File**: `src/routes/pool/[id]/bracket/+page.svelte:13-34, 211-216`
**Description**: Sentinel string instead of a typed enum. Easy to typo. Make it `const WILDCARD = '?' as const;` and use throughout.

---

## §6. DEPLOYMENT & OPS

### §6.1 — HIGH — Module-level live-scores provider detection runs at import time
**File**: `src/lib/server/live-scores.ts:13-21`
**Description**: `const _provider = process.env.API_FOOTBALL_KEY ? 'api-football' : process.env.ENABLE_FIFA_FALLBACK ? 'fifa-stub' : 'none';` runs once at import. SvelteKit imports this on cold start; subsequent env-var changes (`kubectl set env`) are not respected without restart. Documenting; arguably correct.

### §6.2 — MEDIUM — `db.ts` `_pool` is initialized once with `ssl: { rejectUnauthorized: false }` for non-loopback URLs
**File**: `src/lib/server/db.ts:14`
**Description**: Disabling cert verification is acceptable for Neon (their cert chain is sometimes not in Node's bundle), but it makes MITM possible against the DB if traffic ever leaves Neon's private network. Document and consider switching to `ssl: 'require'` once Neon publishes CA bundle path.

### §6.3 — MEDIUM — `shutdown()` race with concurrent requests
**File**: `src/lib/server/db.ts:30-46`
**Description**: When SIGTERM arrives, `_shuttingDown = true` and `_pool.end()` is awaited. In-flight requests that hit `getPool()` AFTER the flag is set throw. Better: drain (await in-flight) before flipping the flag, or expose `application_name` so DBA can find blockers.

### §6.4 — MEDIUM — `audit.ts` logs failures only via `auditFailureCount.value++` + console.error
**File**: `src/lib/server/audit.ts:8-16`
**Description**: The "expose for monitoring" promise (line 6) is never fulfilled — no endpoint reads `auditFailureCount`. The counter resets on process restart; failures are lost. Connect this to `/api/health` or a dedicated metrics endpoint.

### §6.5 — LOW — `/api/health` doesn't expose pool / cache metrics
**File**: `src/routes/api/health/+server.ts:5-13`
**Description**: Returns `{status, db}` only. Add `_pool.totalCount/_pool.idleCount`, `_sessionCache.size`, `auditFailureCount.value`. Cheap, valuable.

### §6.6 — LOW — `seed.ts` has duplicate FIFA rank 48 (Qatar, Ivory Coast) — flagged in comments
**File**: `src/lib/server/seed.ts:9-10`
**Description**: Documented in code as intentional but a future migration that uses `fifa_rank` as a unique key will fail.

---

## §7. CODE QUALITY

### §7.1 — MEDIUM — Pervasive `as any` casts on DB row shapes
**Files**: `src/lib/server/queries.ts:56-58, 117-119`, `src/routes/pool/[id]/+page.server.ts:18, 71, 76, 83, 86, 90, 100`, `src/routes/api/admin/pool-creators/+server.ts:11, 30`, many more.
**Description**: Loses the benefit of `src/lib/server/types.ts`. Replace `as any` with the actual interface types and let TypeScript catch column drift.

### §7.2 — MEDIUM — `getCachedPoolResults` "forbidden keys" check is dev-only
**File**: `src/lib/server/cache.ts:140-148`
**Description**: The runtime guard against caching user-scoped data only runs in non-production. A regression in prod will silently mix user data into the per-pool cache.
**Fix**: Run the check unconditionally; throwing in prod is cheap and only triggers on a real regression.

### §7.3 — MEDIUM — `selectedPrediction = predictions.find(p => p.label === selectedLabel)` is O(n) per request and the comparison is case-sensitive
**File**: `src/routes/pool/[id]/predict/+page.server.ts:54`, `…/bracket/+page.server.ts:39`
**Description**: Predictions sharing a label that differs only in case would not be findable. Documented in /api/predictions/group (uppercase normalization) but NOT here.

### §7.4 — LOW — `R32_TO_R16` and `R16_TO_QF` are flat arrays of indices instead of pairs of pairs
**File**: `src/routes/pool/[id]/bracket/+page.svelte:45-54, 313`

### §7.5 — LOW — Several catch blocks do `console.error('...:', e)` with no error code
**Files**: `…/admin/recalculate/+server.ts:26`, `…/admin/fifa-sync/+server.ts:39-40`, `…/admin/scoring/+server.ts:29, 96`, `…/admin/pool-creators/+server.ts:20, 40`, `…/admin/payment/+server.ts:56`, `…/admin/reset-password/+server.ts:28`, `…/admin/backup/+server.ts:18, 33, 58`, `…/admin/settings/+server.ts:25`, `…/admin/sync-scores/+server.ts` (uses errCode), `pools/+server.ts:42`
**Description**: Inconsistent error correlation. `change-password`, `pools/join`, `predictions/*` all use `errCode()`. Admin endpoints don't. Standardize.

### §7.6 — LOW — `migrate.ts` reads SQL synchronously inside an async function
**File**: `src/lib/server/migrate.ts:70`

### §7.7 — LOW — `pool/[id]/+page.server.ts` rebuilds `groupStandings` (server-side) AND `summary/+page.server.ts` does the same independently — drift risk
**Files**: `src/routes/pool/[id]/+page.server.ts:180-205`, `src/routes/pool/[id]/summary/+page.server.ts` (similar), `src/lib/server/scoring.ts:46-75`
**Description**: Three implementations of "build standings from finished group matches." All currently agree on `pts → gd → gf` (and miss H2H per §2.3). Extract one helper.

---

## §8. NOTABLE NON-FINDINGS (verified safe)

- **CSRF**: hooks.server.ts's Origin check + sameSite=lax cookies + SvelteKit's built-in form-action CSRF give layered defence. ✅
- **SQL injection**: All queries reviewed use `$1/$2` parameterization. The only string-interpolation site (`leaderboard/+page.server.ts:28-30`) guards with `Number.isInteger` on both interpolated values. ✅
- **Session storage**: `crypto.randomBytes(32).toString('hex')` is 256 bits. ✅
- **Password hashing**: `scrypt` with random 16-byte salt and 64-byte derived key; `timingSafeEqual` for compare. ✅
- **Pool join enumeration**: `generateInviteCode()` produces 24-char base64url-uppercase strings (~126 bits effective) — strong against enumeration. ✅ (but see §1.14 for handler mismatch)
- **Bracket advisory lock**: `pg_try_advisory_xact_lock` per-pool prevents concurrent scoring runs from racing. ✅
- **Per-phase deadline gating** on bracket and group endpoints uses `kickoff_time <= NOW()` correctly. ✅
- **Match-scores rescoring**: Inline rescore matches the spec comment about lockstep totals. ✅

---

## §9. PRIORITIZED REMEDIATION PLAN

1. **Immediate (security)**: §1.1, §1.2, §1.3, §1.14, §2.2, §2.7.
2. **High-data-integrity**: §2.4, §2.5, §2.6, §2.11.
3. **API robustness**: §1.4, §1.5, §1.6, §1.7, §1.8, §1.9, §3.1, §3.3, §2.8.
4. **Frontend correctness**: §4.1, §4.2, §4.3, §4.4, §5.1, §5.2.
5. **Operational hygiene**: §6.4, §6.5, §7.5.

End of report.
