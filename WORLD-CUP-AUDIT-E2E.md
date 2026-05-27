# World Cup Pool — End-to-End User Flow Audit

**Audit #2 of 6 — End-to-End User Flows**
Date: 2026-05-27
Auditor: Claude Sonnet 4.6

---

## Executive Summary

Seven complete user flows traced across 25+ source files. **2 CRITICAL bugs** completely break primary
user flows (group prediction saving always fails; duplicate-username registration silently 500s). **4 HIGH
bugs** break key features outright. **11 MEDIUM bugs** degrade correctness or create silent failures.
Both critical bugs appear to be regressions from the SQLite → PostgreSQL migration.

---

## Flow 1 — Registration → Login

### Files
| File | Role |
|---|---|
| `src/routes/login/+page.svelte` | UI form (login + register in one component) |
| `src/routes/api/auth/[action]/+server.ts` | POST handler for login/register/logout |
| `src/lib/server/queries.ts` | `createUser`, `authenticateUser`, `createSession` |
| `src/hooks.server.ts` | Session hydration, route protection |
| `src/lib/server/cache.ts` | Session TTL cache (60 s) |

### Flow Steps
1. User visits `/login`; hook does not redirect logged-in user.
2. Fills username/password (+ optional display_name for register), submits form.
3. `POST /api/auth/register` → validates fields → `createUser()` → `createSession()` → sets cookie → returns `{ ok: true }`.
4. Client does `window.location.href = '/'`.
5. Hook looks up session token in cache/DB, populates `locals.user`.
6. Protected routes check `locals.user` and redirect unauthenticated visitors to `/login`.

### Bugs Found

**[CRITICAL] B1-1 — Duplicate-username registration returns 500 on PostgreSQL**
- **File:** `src/routes/api/auth/[action]/+server.ts:61`
- **Severity:** CRITICAL
- **Code:**
  ```typescript
  if (e.message?.includes('UNIQUE constraint')) {
    return json({ error: 'Nombre de usuario ya en uso' }, { status: 409 });
  }
  ```
- **Problem:** This is the SQLite error string. PostgreSQL's unique-violation message is
  `"duplicate key value violates unique constraint \"users_username_key\""` — lowercase `unique constraint`.
  JavaScript `includes()` is case-sensitive, so `'UNIQUE constraint'` never matches. The catch block falls
  through to `return json({ error: 'Error al registrar' }, { status: 500 })`, giving the user a generic
  error and hiding the actionable "username taken" message.
- **Fix:** Check `e.code === '23505'` (PostgreSQL error code for unique violation).

**[LOW] B1-2 — No redirect for already-authenticated users at /login**
- **File:** `src/routes/login/+page.svelte`, `src/hooks.server.ts`
- **Severity:** LOW
- **Problem:** `/login` is in `publicPaths`, so the hook allows any authenticated user to view it.
  They can re-register or re-login, creating duplicate sessions. A logged-in user should be redirected to `/`.
- **Fix:** In `hooks.server.ts`, if `event.locals.user` exists and `path === '/login'`, redirect to `/`.

**[LOW] B1-3 — Rate limiter is per-process only**
- **File:** `src/routes/api/auth/[action]/+server.ts:4`
- **Severity:** LOW
- **Problem:** The `_attempts` Map is module-level. With multiple server instances (Railway replicas,
  Vercel), each instance has its own counter and the 10-attempt limit is trivially bypassed by rotating
  between instances.
- **Fix:** Move rate-limit tracking to a shared store (PostgreSQL, Redis) or add a note accepting the limitation.

**[LOW] B1-4 — Logout uses `throw redirect` instead of `return redirect`**
- **File:** `src/routes/api/auth/[action]/+server.ts:35`
- **Severity:** LOW
- **Problem:** `throw redirect(303, "/login")` inside a `RequestHandler` works in SvelteKit but is
  semantically unusual; the cookie is deleted before the throw, so it's functionally correct. However,
  the pattern differs from SvelteKit convention (using `return redirect()` in server handlers).
  Not a bug but a code smell.

### Missing Error Handling
- No validation of `display_name` content (only length). Emoji, HTML, etc. are stored as-is.
- No server-side check that the `action` param is one of the expected three values before JSON body parsing; a request to `/api/auth/anything` still parses JSON.

---

## Flow 2 — Pool Creation

### Files
| File | Role |
|---|---|
| `src/routes/pools/create/+page.svelte` | UI form |
| `src/routes/api/pools/+server.ts` | POST handler |
| `src/lib/server/queries.ts` | `createPool()` — transaction: INSERT pool + auto-join + scoring defaults |

### Flow Steps
1. User visits `/pools/create` (auth required via hook).
2. Fills name, buy-in, allow_multiple toggle.
3. `POST /api/pools` → `canCreatePools()` check → `createPool()` → returns `{ id, invite_code }`.
4. Client redirects to `/pool/{id}`.
5. Creator is auto-joined as first member; 10 default scoring rules inserted in same transaction.

### Bugs Found

**[MEDIUM] B2-1 — No pool name maximum length validation on server**
- **File:** `src/routes/api/pools/+server.ts:32`
- **Severity:** MEDIUM
- **Problem:** Server validates `name.trim().length < 2` but not a maximum. The DB column is `TEXT` (unlimited). A 10 000-character pool name would be stored and rendered.
- **Fix:** Add `name.trim().length > 100` guard.

**[MEDIUM] B2-2 — `buy_in` type guard is fragile**
- **File:** `src/routes/api/pools/+server.ts:33`
- **Severity:** MEDIUM
- **Problem:** `typeof buy_in === 'number' && buy_in < 0` — the typeof guard means a string `"−5"` would bypass the negative check. The frontend sends `parseFloat(buyIn) || 0`, so it's currently a number, but the guard is misleading and easy to break.
- **Fix:** `const buyin = Number(buy_in); if (!isFinite(buyin) || buyin < 0) { return error }`.

**[LOW] B2-3 — No currency selection exposed**
- **File:** `src/routes/pools/create/+page.svelte`, `src/lib/server/queries.ts:69`
- **Severity:** LOW
- **Problem:** `createPool()` defaults `currency = 'EUR'` but the create form has no currency field. All pools are EUR regardless of locale.

**[INFO] B2-4 — Pool URLs use numeric IDs, not slugs**
- **Severity:** INFO
- **Problem:** Pool URLs are `/pool/123` (sequential IDs), which exposes pool count and allows enumeration. The audit spec asked about slug generation; none exists.

### Missing Error Handling
- `canCreatePools()` makes 2–3 DB queries; no error handling if any query fails.
- After `createPool()` fails mid-transaction and rolls back, the error is rethrown as-is (no user-friendly wrapping).

---

## Flow 3 — Pool Join → Invite

### Files
| File | Role |
|---|---|
| `src/routes/join/[code]/+page.server.ts` | Load: pass code to page, auth-gate |
| `src/routes/join/[code]/+page.svelte` | Auto-join on mount via `$effect` |
| `src/routes/api/pools/join/+server.ts` | POST: lookup pool by invite code, insert pool_member |
| `src/lib/server/queries.ts` | `getPoolByInvite()`, `joinPool()` |
| `src/routes/s/[code]/+page.server.ts` | Public leaderboard (uses invite_code as URL segment) |

### Flow Steps
1. User receives share link `/join/{INVITE_CODE}`.
2. Page load server verifies auth (redirects to `/login` if not), passes code to client.
3. Svelte `$effect` fires immediately on mount → calls `handleJoin()` → `POST /api/pools/join`.
4. Server: `code.toUpperCase()` → `getPoolByInvite()` → `joinPool()` inserts into `pool_members` (UNIQUE constraint handles duplicates via `e.code === '23505'`).
5. Client redirects to `/pool/{pool_id}`.

### Bugs Found

**[MEDIUM] B3-1 — No member limit enforcement**
- **File:** `src/routes/api/pools/join/+server.ts`
- **Severity:** MEDIUM
- **Problem:** No check on number of existing members. A pool could grow unbounded; in a paid pool this could be a financial issue (late joiners might not have paid before the deadline).

**[MEDIUM] B3-2 — Public leaderboard URL exposes invite code**
- **File:** `src/routes/s/[code]/+page.server.ts`
- **Severity:** MEDIUM
- **Problem:** The shareable leaderboard URL is `/s/{invite_code}`. Anyone who sees this URL (e.g., in browser history, screenshot, social share) has the invite code and can join the pool. This conflates "viewing leaderboard" with "ability to join."
- **Fix:** Generate a separate, non-joinable share token, or remove the public leaderboard URL and require login.

**[LOW] B3-3 — No invite code format validation in join API**
- **File:** `src/routes/api/pools/join/+server.ts:8`
- **Severity:** LOW
- **Problem:** Any arbitrary string is passed to the DB query. Should validate `code` matches expected format (16 uppercase base64url chars) before querying.

**[LOW] B3-4 — Auto-join `$effect` has double-fire risk on first render**
- **File:** `src/routes/join/[code]/+page.svelte:33-37`
- **Severity:** LOW
- **Problem:**
  ```js
  $effect(() => {
    if (data.code && !loading && !joined && !error) {
      handleJoin(new Event('auto'));
    }
  });
  ```
  A fake `Event('auto')` is passed. `handleJoin` calls `e.preventDefault()` on it — which is harmless but semantically wrong. More critically, if the effect re-fires before `loading` becomes reactive (e.g., during SSR hydration reconciliation), two join requests could be sent.

**[LOW] B3-5 — No pool active-status check on join**
- **File:** `src/routes/api/pools/join/+server.ts`
- **Severity:** LOW
- **Problem:** `getPoolByInvite()` queries `WHERE invite_code = $1` without filtering `is_active`. Users can join deactivated pools.

### Missing Error Handling
- The "already a member" message ("Ya estás en esta quiniela") is shown on the error path with no distinction between "you created this pool" and "you joined this pool via another link." First-time pool creators who accidentally follow their own invite link see a confusing error.

### Race Conditions
- Two concurrent requests from the same user with the same code: both would check membership (both miss), then both attempt `INSERT INTO pool_members`. The second would fail with `23505`, caught and returning false (409). This is handled correctly.

---

## Flow 4 — Group Stage Predictions

### Files
| File | Role |
|---|---|
| `src/routes/pool/[id]/predict/+page.server.ts` | Load: pool, teams, existing predictions |
| `src/routes/pool/[id]/predict/+page.svelte` | Drag-drop + tap-to-rank UI, auto-save |
| `src/routes/api/predictions/group/+server.ts` | POST: validate + upsert group_predictions |
| `src/routes/api/predictions/entry/+server.ts` | POST: create a new prediction entry |

### Flow Steps
1. User navigates to `/pool/{id}/predict` (auth required).
2. Server loads teams grouped by group_name, existing predictions for this user, existing group selections.
3. User drags/taps teams into ranked positions 1–4 per group.
4. Auto-save fires 600 ms after last change → `POST /api/predictions/group`.
5. Server: ownership check → membership check → deadline check → per-match kickoff check → team validation → upsert `group_predictions`.

### Bugs Found

**[CRITICAL] B4-1 — Group prediction team validation always fails (PostgreSQL bigint type mismatch)**
- **File:** `src/routes/api/predictions/group/+server.ts:113-119`
- **Severity:** CRITICAL
- **Problem:**
  ```typescript
  const { rows: validRows } = await query(
    `SELECT COUNT(*) as cnt FROM teams WHERE group_name = $1 AND id = ANY($2::int[])`,
    [groupName, filled]
  );
  if (validRows[0].cnt !== filled.length) {
    return json({ error: `Equipo inválido en grupo ${groupName}` }, { status: 400 });
  }
  ```
  PostgreSQL's `COUNT(*)` returns `bigint`, which the `pg` driver exposes as a JavaScript **string**
  (e.g., `"4"`). `filled.length` is a JavaScript **number** (e.g., `4`). The strict inequality
  `"4" !== 4` is always `true`. Therefore, **every group prediction save attempt with at least one
  filled position returns 400 "Equipo inválido en grupo X"**. Group stage predictions are completely
  broken.
- **Affected scope:** All users on all pools — the primary prediction flow.
- **Fix:**
  ```typescript
  if (Number(validRows[0].cnt) !== filled.length) {
  ```

**[HIGH] B4-2 — No prediction entry auto-created on first visit; silent save failure**
- **File:** `src/routes/pool/[id]/predict/+page.server.ts`, `src/routes/pool/[id]/predict/+page.svelte:182`
- **Severity:** HIGH
- **Problem:** Joining a pool creates a `pool_members` row but **not** a `predictions` entry. When the user visits `/pool/{id}/predict`, `getUserPredictions()` returns `[]`, `selectedId` is `null`. The UI renders the group cards normally. When auto-save fires:
  ```javascript
  body: JSON.stringify({ prediction_id: data.selectedId, groups })
  //   prediction_id: null
  ```
  The API gets `prediction_id: null`, which is falsy → returns 400. The client's `savePredictions()` only checks `if (res.ok)` to show the saved indicator; it does not show an error. **Users believe their predictions are being saved but nothing persists.**

  Compounding issue: When `allow_multiple_predictions` is false (the default), the "Nueva entrada" button is hidden. There is **no visible UI path** for a first-time member with no existing prediction to create their entry. They are stuck on a page that looks functional but silently discards all input.
- **Fix:** In `predict/+page.server.ts` load function, if `predictions.length === 0` and the user is a pool member, auto-create a prediction entry:
  ```typescript
  if (predictions.length === 0) {
    await createPrediction(poolId, locals.user.id, '');
    predictions = await getUserPredictions(poolId, locals.user.id);
  }
  ```

**[HIGH] B4-3 — `allow_multiple_predictions` boolean comparison broken after PostgreSQL migration**
- **File:** `src/routes/pool/[id]/predict/+page.svelte:9`, `src/routes/pool/[id]/admin/+page.svelte:75`
- **Severity:** HIGH
- **Problem:**
  ```javascript
  const allowMultiple = pool.allow_multiple_predictions === 1;
  ```
  The DB column `allow_multiple_predictions` is `BOOLEAN DEFAULT FALSE` (see migration 0001). PostgreSQL
  BOOLEAN is returned by the `pg` driver as a JavaScript `boolean` (`true`/`false`), **not** as `1`/`0`.
  So `true === 1` is `false` in JavaScript. This means:
  - The "Nueva entrada" button is **always hidden**, even when the admin has enabled multiple predictions.
  - `allowMultiple` is always `false`, preventing creation of additional entries.
  - The same bug appears in `pool/[id]/admin/+page.svelte:75`.
- **Fix:** Change to `const allowMultiple = !!pool.allow_multiple_predictions;` (or `=== true`).

**[MEDIUM] B4-4 — Phase-level kickoff deadline blocks unrelated phases**
- **File:** `src/routes/api/predictions/group/+server.ts:81-89`
- **Severity:** MEDIUM
- **Problem:** The per-match kickoff check queries:
  ```sql
  SELECT 1 FROM matches WHERE group_name = ANY($1::text[]) AND kickoff_time <= NOW() LIMIT 1
  ```
  This fires on all submitted groups, not just the group being edited. If Group A has started, a user cannot update Group L predictions even though Group L hasn't kicked off yet.
- **Fix:** Split the save into per-group calls, or filter only the submitted `group_name` against matches that have started.

**[MEDIUM] B4-5 — Drag-and-drop reorder has off-by-one when dropping below source**
- **File:** `src/routes/pool/[id]/predict/+page.svelte:150-155`
- **Severity:** MEDIUM
- **Problem:**
  ```javascript
  arr.splice(srcSlot, 1);         // Remove from original index
  arr.splice(slotIndex, 0, movingTeamId);  // Insert at target index
  ```
  When `slotIndex > srcSlot`, removing the element at `srcSlot` shifts all subsequent elements down by 1.
  The `slotIndex` now points to one position past the intended target. For example, dragging position 1
  to position 3 actually places the team in position 4 (or past the end of the 4-element array).
- **Fix:** Adjust target: `const adjustedTarget = slotIndex > srcSlot ? slotIndex - 1 : slotIndex;`

**[LOW] B4-6 — Partial group predictions are accepted (positions 1+2 only, no 3+4)**
- **File:** `src/routes/api/predictions/group/+server.ts`
- **Severity:** LOW
- **Problem:** No server-side requirement that all 4 positions are filled. A user can save pos1 and pos2 only. At scoring time, `calculateGroupScores` awards points only for matched positions, so partial predictions are scored on positions that exist. But users may not realize they left positions unscored.

### Missing Error Handling
- Auto-save in `+page.svelte` silently swallows all save errors (`catch (e) { console.error(e); }`). Users see no notification when saves fail.
- No server-side check that the user is actually a member of the pool _before_ loading the predict page (only checked at save time).

---

## Flow 5 — Knockout Bracket Predictions

### Files
| File | Role |
|---|---|
| `src/routes/pool/[id]/bracket/+page.server.ts` | Load: pool, group preds, existing bracket, teams |
| `src/routes/pool/[id]/bracket/+page.svelte` | Interactive bracket UI with cascade logic |
| `src/routes/api/predictions/bracket/+server.ts` | POST: validate + upsert bracket_predictions |

### Flow Steps
1. User navigates to `/pool/{id}/bracket`.
2. Server loads group predictions (used to derive R32 matchups), existing bracket picks, all teams.
3. User clicks teams in each round; client-side cascade propagates winners forward (R32→R16→QF→SF→Final) and losers to 3rd-place match.
4. Auto-save fires 800 ms after last change → `POST /api/predictions/bracket`.
5. Server: ownership → membership → knockout deadline → per-match kickoff → team ID validation → transactional upsert.

### Bugs Found

**[HIGH] B5-1 — Same silent-failure bug as group stage (no prediction entry)**
- **File:** `src/routes/pool/[id]/bracket/+page.server.ts`
- **Severity:** HIGH
- **Problem:** Same as B4-2. If `predictions` is empty (no entry exists for user), `selectedId` is null. `saveBracket()` sends `prediction_id: null` → 400 → error swallowed. Users can interact with the bracket but nothing saves.

**[MEDIUM] B5-2 — Bracket deadline check blocks all phases if any submitted phase has started**
- **File:** `src/routes/api/predictions/bracket/+server.ts:85-94`
- **Severity:** MEDIUM
- **Problem:**
  ```typescript
  const { rows: started } = await query(
    `SELECT 1 FROM matches WHERE phase = ANY($1::text[]) AND kickoff_time <= NOW() LIMIT 1`,
    [phases]  // ALL phases submitted in the request
  );
  if (started.length > 0) {
    return json({ error: 'Algunos partidos ya comenzaron' }, { status: 400 });
  }
  ```
  The bracket UI sends all phases in a single request. If R32 has started (which happens at tournament
  start), users cannot update their SF or Final predictions even though those matches are weeks away.
- **Fix:** Per-phase deadline enforcement: check `WHERE phase = $1 AND kickoff_time <= NOW()` separately for each phase.

**[MEDIUM] B5-3 — Bracket consistency not validated server-side**
- **File:** `src/routes/api/predictions/bracket/+server.ts`
- **Severity:** MEDIUM
- **Problem:** The server accepts any team_id in any bracket slot without checking tournament progression logic. A user could (via direct API call) predict Germany in R16 but Argentina in QF (as if Argentina beat Germany in R16 and Germany somehow advanced to QF simultaneously). The cascade logic exists only in the client.
- **Fix:** Server-side bracket consistency check: for each QF slot, verify the predicted team appears in the R16 slot that feeds it, etc. OR accept the current design as "phase-level predictions" rather than bracket-consistency predictions.

**[LOW] B5-4 — Bracket fallback uses arbitrary team order when no group predictions exist**
- **File:** `src/routes/pool/[id]/bracket/+page.svelte:147-154`
- **Severity:** LOW
- **Problem:** `getGroupTeam()` falls back to `teamsByGroup[group][pos-1]` (alphabetical seeding order) when no group prediction exists. This auto-populates R32 slots with placeholder teams, potentially confusing users into thinking these are their actual picks.

### Missing Error Handling
- `saveBracket()` in `+page.svelte` does not surface errors to the user (`else { saveError = 'Error al guardar'; setTimeout(() => saveError = null, 3000) }` — error disappears in 3 seconds with no retry).
- 3rd-place team selector (`get3rdOptions`) silently returns empty if group predictions aren't completed.

### Race Conditions
- Auto-save fires 800 ms after any pick. Rapid picking can trigger multiple concurrent save requests. The transaction in the bracket POST prevents corruption, but the last request to complete "wins" regardless of intent order.

---

## Flow 6 — Match Results → Scoring

### Files
| File | Role |
|---|---|
| `src/routes/api/admin/results/+server.ts` | POST: update match result + trigger async scoring |
| `src/routes/api/admin/fifa-sync/+server.ts` | POST: FIFA API stub + trigger sync scoring |
| `src/routes/api/admin/recalculate/+server.ts` | POST: pool-level manual rescore trigger |
| `src/lib/server/scoring.ts` | `calculateAllScores()` → group/bracket/match sub-functions |

### Flow Steps
1. Admin enters match result via POST `/api/admin/results { match_id, home_score, away_score }`.
2. Admin re-verified against DB (`SELECT is_admin FROM users`).
3. Match updated: `status = 'finished'`, scores written.
4. `setImmediate()` fires background scoring across all active pools.
5. Each pool: `calculateAllScores(poolId)` → group scores → bracket scores → match scores → total_score UPDATE — all in one transaction.
6. Cache invalidation: per-pool leaderboard + results + global leaderboard.

### Bugs Found

**[HIGH] B6-1 — FIFA sync does not invalidate caches after rescoring**
- **File:** `src/routes/api/admin/fifa-sync/+server.ts:23-36`
- **Severity:** HIGH
- **Problem:**
  ```typescript
  for (const p of pools) {
    await calculateAllScores(p.id);
    // ← no cache invalidation!
  }
  return json({ ok: true, ... });
  ```
  After `/api/admin/fifa-sync` rescores all pools, `invalidateCachedPoolLeaderboard()`,
  `invalidateCachedPoolResults()`, and `invalidateGlobalLeaderboard()` are never called. Users see
  stale leaderboards for up to 60 seconds (POOL_RESULTS_TTL). Compare with `/api/admin/results` which
  does invalidate caches.
- **Fix:** Add cache invalidation after each pool rescore, matching the pattern in `results/+server.ts`.

**[MEDIUM] B6-2 — Background scoring failures are invisible to admin**
- **File:** `src/routes/api/admin/results/+server.ts:53-64`
- **Severity:** MEDIUM
- **Problem:** The API immediately returns `{ ok: true, scoring: 'pending' }`. Scoring runs in `setImmediate()`. If it fails, the error is console-logged and stored in `pools.last_score_error`, but the admin UI shows no indication of failure. Admins may believe scoring succeeded when it silently failed.
- **Fix:** Poll `last_score_error` from the pool admin page, or use a webhook/SSE to signal completion.

**[MEDIUM] B6-3 — Concurrent score-result updates race on same pool**
- **File:** `src/routes/api/admin/results/+server.ts`
- **Severity:** MEDIUM
- **Problem:** Two rapid admin result submissions for different matches → two `setImmediate` callbacks → two concurrent `calculateAllScores(poolId)` calls. Each runs its own transaction reading from the same predictions. The last transaction to commit wins and may overwrite points from the first. Under normal usage this is rare, but during live match entry it can happen.
- **Fix:** Serialize scoring with a per-pool queue (e.g., a Map of pending Promises) or use PostgreSQL advisory locks.

**[MEDIUM] B6-4 — Knockout tie-score handling requires misleading admin input**
- **File:** `src/lib/server/scoring.ts:137-140`
- **Severity:** MEDIUM
- **Problem:**
  ```typescript
  if (m.home_score === m.away_score) {
    console.warn(`Knockout match ${m.id} has equal scores — skipping`);
    continue;
  }
  ```
  Knockout matches that go to extra time and penalties often end 0–0 AET. The system skips scoring for
  any match where `home_score === away_score`. Admin must enter the post-penalty result as if the winning
  team scored 1 and the loser scored 0 (artificially). There is no AET flag, no penalty-winner field, and
  no guidance in the UI.
- **Fix:** Add an `is_penalty_win BOOLEAN` column (or `winner_team_id`) to matches; scoring uses that
  instead of score comparison.

**[LOW] B6-5 — `calculateGroupScores` does not reset points when results are reverted**
- **File:** `src/lib/server/scoring.ts:88-102`
- **Severity:** LOW
- **Problem:** When computing group scores, groups with no finished matches are skipped (`if (!actual) continue`). If an admin corrects a result from "finished" back to "scheduled" (no UI for this, but possible via DB), previously awarded `points_earned` on `group_predictions` rows are never zeroed out. Recalculation is not idempotent in that edge case.

**[LOW] B6-6 — `calculateGroupScores` group standings use only points+GD+GF — no head-to-head**
- **File:** `src/lib/server/scoring.ts:67-71`
- **Severity:** LOW
- **Problem:** FIFA's official tiebreaker order is: points → head-to-head → goal difference → goals scored → FIFA ranking. The app uses only points → GD → GF. Two teams with identical points and GD but head-to-head advantage may be ranked incorrectly. This directly affects whether group prediction positions earn points.

### Missing Error Handling
- `/api/admin/results` does not verify the match belongs to any active pool before triggering scoring — it rescores ALL active pools even if the match is not in their scoring scope.
- No upper bound on `home_score`/`away_score` validation in `calculateMatchScores` — it trusts whatever is in the DB.

---

## Flow 7 — Payment Tracking

### Files
| File | Role |
|---|---|
| `src/routes/api/admin/payment/+server.ts` | POST: toggle has_paid on predictions + pool_members |
| `src/routes/pool/[id]/admin/+page.svelte` | Admin UI: member list with payment toggles |
| `src/lib/server/queries.ts` | `getPoolMembers()` — used to load member list |

### Flow Steps
1. Pool admin opens `/pool/{id}/admin`.
2. Admin page shows member list with payment status checkboxes.
3. Admin clicks checkbox → `POST /api/admin/payment { pool_id, entry_id?, user_id?, has_paid }`.
4. Server verifies requester is pool creator → updates `predictions.has_paid` and/or `pool_members.has_paid`.

### Bugs Found

**[MEDIUM] B7-1 — Silent no-op when neither `user_id` nor `entry_id` is provided**
- **File:** `src/routes/api/admin/payment/+server.ts:29-41`
- **Severity:** MEDIUM
- **Problem:** The handler validates `pool_id` but not that at least one of `user_id` or `entry_id` is present. A POST with only `{ pool_id, has_paid: true }` runs BEGIN/COMMIT with no UPDATEs and returns `{ ok: true }`.
- **Fix:** Add `if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });`.

**[MEDIUM] B7-2 — New prediction entries default `has_paid = false` after admin toggles user-level payment**
- **File:** `src/lib/server/queries.ts:169-175`, `src/routes/api/admin/payment/+server.ts:37-40`
- **Severity:** MEDIUM
- **Problem:** When an admin marks a user as paid, both `pool_members.has_paid` and all existing `predictions.has_paid` are set to `true`. But `createPrediction()` inserts with `has_paid` unset (it uses the DB default of `false`). If the user later creates a second entry (via the multiple-entries feature), that new entry will show as unpaid, even though the user already paid.
- **Fix:** When creating a prediction, inherit `has_paid` from `pool_members` for that user.

**[LOW] B7-3 — Payment auth doesn't allow site-wide admins to toggle other pools**
- **File:** `src/routes/api/admin/payment/+server.ts:18-19`
- **Severity:** LOW
- **Problem:** `pool.created_by !== locals.user.id` restricts payment management to the pool creator only. Site-level admins (`is_admin = true`) cannot manage payments for pools they didn't create. This is intentional design but may be a gap for support scenarios.

**[INFO] B7-4 — `getPoolMembers()` has column alias typo `od_user_id`**
- **File:** `src/lib/server/queries.ts:154`
- **Severity:** INFO
- **Problem:**
  ```sql
  SELECT u.id as od_user_id, u.username, ...
  ```
  The alias should be `user_id` but is `od_user_id` (transposition of 'o' and 'd'). The admin Svelte page was written to match this typo (`m.od_user_id`), so the feature works, but it's a maintenance hazard — any new code assuming `member.user_id` will get `undefined`.
- **Fix:** Rename alias to `user_id` in `queries.ts` and update all references.

---

## Flow 8 — Edge Cases

### 8a — User predicts after deadline

**Finding [MEDIUM]:** When a user has the predict page open before the deadline and the deadline passes mid-session:
- The countdown timer correctly shows "Cerrado" and the UI freezes inputs (`disabled={data.isLocked}`).
- However, `data.isLocked` is set server-side at page-load time and **does not update client-side** when the deadline passes.
- A user who loaded the page 10 minutes before deadline will still have enabled inputs until the next full page load.
- When they do save (via auto-save still running from before deadline), the API correctly rejects with 403.
- The 403 is swallowed silently in the `savePredictions` try-catch.

**Recommendation:** Add a client-side deadline check that disables inputs when `countdown` reaches 0, and show a visible error when a save returns 403.

### 8b — Pool with 0 members

**Finding [LOW]:** Impossible at creation (creator auto-joins), but if the creator leaves via direct DB deletion:
- `getPoolMembers()` returns empty array.
- `getPoolLeaderboard()` returns empty array (no predictions).
- Pool page renders with empty leaderboard and 0 members — no error, just empty state. No crash.
- Admin page still functions for the (now non-member) creator.

### 8c — All matches finished

**Finding [LOW]:** No end-of-tournament state machine. The app continues showing:
- Prediction tabs as editable (if no deadline set).
- Bracket page as editable.
Users can technically change predictions after all matches are done (if no pool deadline is configured).
**Recommendation:** Add a pool-level `status` field (or derive from match states) and lock predictions when tournament is complete.

### 8d — Tied leaderboard scores

**Finding [MEDIUM]:** The tiebreaker system is:
1. `total_score DESC`
2. `total_correct DESC` (total number of correct individual predictions)
3. `tiebreaker_close ASC` (sum of absolute errors on predicted final score)

If two users have identical values on all three criteria, ranking is arbitrary (PostgreSQL sort is not stable for equal rows). There is no final tiebreaker (e.g., earlier submission date). This could make tied winners feel the result is unfair.

**Recommendation:** Add `updated_at ASC` as a final tiebreaker (first to submit wins).

### 8e — Pool leaderboard at pool level vs shared URL uses different enrichment paths

**Finding [MEDIUM]:** The pool-level leaderboard (`/pool/[id]/+page.server.ts`) and the public leaderboard (`/s/[code]/+page.server.ts`) have divergent enrichment code:
- The pool page uses `ANY($1::int[])` with an array parameter.
- The public page builds a manual `IN (${ph})` string with individual `$N` placeholders.
- The pool page includes a tiebreaker closeness calculation; the public page does not.
- The pool page sorts by `total_score, total_correct, tiebreaker_close`; the public page sorts only by `total_score, total_correct`.

This means the same pool can show a different ranked order between the two views, which is confusing.

**Recommendation:** Extract leaderboard enrichment into a shared server function used by both routes.

### 8f — Group score stale-read after scoring races

**Finding [LOW] (Race Condition):** The total_score UPDATE in `calculateAllScores`:
```sql
UPDATE predictions p SET total_score = sub.total
FROM (SELECT pred.id,
  COALESCE((SELECT SUM FROM group_predictions WHERE prediction_id = pred.id), 0) + ...
  FROM predictions pred WHERE pred.pool_id = $1
) sub WHERE p.id = sub.id
```
This is a correlated subquery inside the transaction. If another session is mid-insert into `group_predictions` or `bracket_predictions` for the same pool (user still saving), the subquery may see partially-written data, depending on isolation level (PostgreSQL default: READ COMMITTED). Under heavy concurrent save + score activity, a user's total_score could be transiently wrong until the next rescore.

---

## Summary Table

| ID | Flow | Severity | Title |
|---|---|---|---|
| B1-1 | Registration | **CRITICAL** | Duplicate-username returns 500 (SQLite UNIQUE string vs PostgreSQL) |
| B4-1 | Group Predictions | **CRITICAL** | COUNT(*) bigint/number mismatch — all group prediction saves rejected |
| B4-2 | Group Predictions | HIGH | No prediction entry auto-created; silent save failure for new members |
| B4-3 | Group/Bracket | HIGH | `allow_multiple_predictions === 1` always false after PG migration |
| B5-1 | Bracket | HIGH | Same no-entry silent save failure on bracket page |
| B6-1 | Scoring | HIGH | FIFA sync skips cache invalidation; stale leaderboards persist |
| B2-1 | Pool Creation | MEDIUM | No pool name max length on server |
| B3-1 | Pool Join | MEDIUM | No member limit |
| B3-2 | Pool Join | MEDIUM | Public leaderboard URL exposes invite code |
| B4-4 | Group Predictions | MEDIUM | Per-match kickoff check blocks unrelated groups |
| B4-5 | Group Predictions | MEDIUM | Drag-and-drop off-by-one when dropping below source |
| B5-2 | Bracket | MEDIUM | Bracket deadline check blocks all phases if any started |
| B5-3 | Bracket | MEDIUM | No server-side bracket consistency validation |
| B6-2 | Scoring | MEDIUM | Background scoring failures invisible to admin |
| B6-3 | Scoring | MEDIUM | Concurrent result updates race on same pool |
| B6-4 | Scoring | MEDIUM | Tie/AET handling requires misleading score input |
| B7-1 | Payment | MEDIUM | Silent no-op when no user_id/entry_id provided |
| B7-2 | Payment | MEDIUM | New entries default has_paid=false after user-level payment set |
| 8a | Edge Case | MEDIUM | Deadline passes mid-session; saves silently fail |
| 8d | Edge Case | MEDIUM | No deterministic final tiebreaker |
| 8e | Edge Case | MEDIUM | Leaderboard order differs between pool page and public /s/ URL |
| B2-2 | Pool Creation | LOW | buy_in type guard fragile |
| B1-2 | Registration | LOW | No redirect for logged-in user at /login |
| B1-3 | Registration | LOW | Rate limiter per-process only |
| B3-3 | Pool Join | LOW | No invite code format validation |
| B4-6 | Group Predictions | LOW | Partial group predictions accepted silently |
| B5-4 | Bracket | LOW | Bracket fallback auto-fills R32 with arbitrary teams |
| B6-5 | Scoring | LOW | Group points not reset when result reverted |
| B6-6 | Scoring | LOW | Group standings tie-breaking ignores head-to-head |
| B7-3 | Payment | LOW | Site-wide admins cannot manage other pools' payments |
| B7-4 | Payment | INFO | Column alias typo `od_user_id` in `getPoolMembers()` |
| 8c | Edge Case | LOW | No tournament-complete lock state |

---

## Priority Fix Order

### Immediate (app is broken without these)
1. **B4-1** — Fix `Number(validRows[0].cnt)` in `api/predictions/group/+server.ts:117`
2. **B1-1** — Fix duplicate-username catch to use `e.code === '23505'`
3. **B4-3** — Fix `=== 1` to `=== true` or `!!` for `allow_multiple_predictions`
4. **B4-2 / B5-1** — Auto-create prediction entry in `predict/+page.server.ts` and `bracket/+page.server.ts`

### Important (silent data loss / security)
5. **B6-1** — Add cache invalidation after FIFA sync scoring
6. **B3-2** — Decouple public leaderboard URL from invite code
7. **8e** — Unify leaderboard enrichment across both routes

### Quality / Robustness
8. **B5-2, B4-4** — Per-phase/group deadline enforcement
9. **B6-4** — AET/penalty handling field
10. **B4-5** — Drag-drop splice off-by-one fix
