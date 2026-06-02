# World Cup Pool — Comprehensive Code Review by Claude Code
## Cost: $0.39 | Files read: 40+ | Date: 2026-05-22

---

## CRITICAL — Fix Before Real Money

### C1: Per-match deadline enforcement is missing
Predictions use a single pool-level `deadline_group` / `deadline_knockout`. There's no per-match deadline. A user could submit a prediction for a match that started 30 minutes ago, after seeing the score on TV. This is a fairness exploit.

**Fix:** Add a `kickoff_time` column to `matches` (from FIFA API data). Before accepting a prediction, check `NOW() < match.kickoff_time - INTERVAL '5 minutes'`.

### C2: Bracket prediction reset happens outside the transaction
In `bracket/+server.ts`, existing bracket predictions are deleted with a DELETE query, then new ones are INSERTed. If the INSERT fails (constraint violation, network error), the old predictions are gone and the new ones don't exist. The user loses their bracket silently.

**Fix:** Wrap DELETE + INSERT in a transaction using `getClient()` + BEGIN/COMMIT/ROLLBACK.

### C3: No session invalidation on password change
`src/routes/api/auth/change-password/+server.ts` updates the password hash but doesn't invalidate existing sessions. The old session cookie continues to work. If an attacker changed the password, the victim could still be logged in (or vice versa).

**Fix:** After password update, `DELETE FROM sessions WHERE user_id = $1 AND token != $2` (keep current session).

### C4: Race condition on prediction submission
Two rapid POSTs to the same prediction endpoint could create duplicate predictions. There's no `ON CONFLICT` handling for the `(user_id, pool_id, label)` unique constraint.

**Fix:** Use `INSERT ... ON CONFLICT (user_id, pool_id, label) DO UPDATE` or add a client-side debounce + server-side advisory lock.

### C5: `scryptSync` is deprecated in Node.js
The `createScryptHash` function uses `crypto.scryptSync`, which is deprecated in recent Node versions. Should migrate to `crypto.scrypt` (async) or `crypto.pbkdf2`.

---

## HIGH — Security & Correctness

### H1: SQL string interpolation in match-scores endpoint
Dynamic IN() clauses are built with string interpolation (`$${i+1}`). While the actual VALUES are parameterized, the placeholder construction is fragile. A mistake here leads to SQL injection.

**Fix:** Use `ANY($1::int[])` instead of dynamic placeholder generation.

### H2: Pool membership not checked on prediction submission
The bracket/group/tiebreaker endpoints verify `user_id` owns the prediction, but don't verify the user is a member of the pool. A user who left a pool could still modify predictions.

**Fix:** Add a membership check: `SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2`.

### H3: Scoring rules not whitelisted
A pool creator can insert arbitrary rule names into `scoring_config`. The scoring engine silently ignores unknown rules — meaning rules could be configured that do nothing and scoring is wrong.

**Fix:** Validate rule names against a `VALID_RULES` set before saving.

### H4: `getUserByUsername` selects `*` including `password_hash`
Returns the full user row including password hash. If any future code returns this to the client, the hash leaks.

**Fix:** Use column-specific SELECT or separate auth query.

### H5: Auth middleware redirects API routes to /login
Unauthenticated `/api/` requests get a 302 redirect to HTML login page instead of 401 JSON. `fetch()` calls silently receive HTML.

**Fix:** Return `json({ error: 'Unauthorized' }, { status: 401 })` for `/api/` paths.

---

## MEDIUM — Performance & Reliability

### M1: Background scoring silently succeeds even when it fails
`setImmediate(async () => { ... catch console.error })` means client always gets `{ ok: true }` regardless of scoring outcome. Leaderboard diverges silently.

**Fix:** Add `last_scored_at` column or use a job queue (pg-boss).

### M2: N+1 queries loading group/bracket predictions
Pool overview loads predictions in a loop: N queries for group_preds + N for bracket_preds.

**Fix:** Use `ANY($1::int[])` batch queries.

### M3: Per-row UPDATEs in scoring transactions
For 100 entries × 64 matches = 6,400 individual UPDATEs. On Neon (~1-5ms latency), potentially 32 seconds.

**Fix:** Use `unnest()` for bulk UPDATE in a single query.

### M4: Scoring rules fetched 3× per calculateAllScores
Each scoring phase independently calls `getScoringRules(poolId)`.

**Fix:** Fetch once, pass as parameter.

### M5: Three scoring phases run in separate transactions
If bracket scores commit but match scores fail, leaderboard is corrupted.

**Fix:** Single transaction for all three phases.

### M6: Missing indexes
`matches.fifa_id`, `pool_members.pool_id`, `predictions.user_id` — all frequently queried, none indexed.

**Fix:** `CREATE INDEX` on all three.

### M7: `cleanSessions` in hot path
`await cleanSessions()` stalls the response for unauthenticated requests.

**Fix:** Remove `await`, fire-and-forget with `.catch()`.

### M8: In-memory cache won't survive multi-instance
Module-level variables are per-process. Fine for single-server, breaks with horizontal scaling.

**Fix:** Document constraint. Use Redis if scaling.

---

## LOW — Code Quality & Feature Gaps

### L1: `deadlinePassed` only checks group deadline
Knockout deadline is ignored in the flag.

### L2: `third_place` default 25 points vs `knockout_winner` 8 points
Third-place prediction worth 3× tournament winner. Almost certainly a typo.

### L3: No password reset or email verification
Users locked out permanently.

### L4: No audit log for admin actions
No record of who changed payments/scores when.

### L5: `pool_id` in results endpoint accepted but never used
Dead parameter.

### L6: Mixed Spanish/English error messages
Inconsistent API responses.

### L7: Pervasive `any` types
No TypeScript protection on DB column access.

### L8: No request body size limit on prediction endpoints
Unbounded JSON body accepted.

### L9: No tests for scoring logic
Most money-critical code, zero tests.

### L10: `allowMultiple` passed as 0/1 to BOOLEAN column
Implicit coercion, should use true/false.

---

## Summary

| Priority | Count | Key items |
|---|---|---|
| Critical | 5 | Per-match deadlines, bracket reset outside txn, no session invalidation, prediction race, scryptSync |
| High | 5 | SQL interpolation, pool membership check, scoring rule whitelist, password hash in SELECT *, API redirects |
| Medium | 8 | Silent scoring failure, N+1, bulk UPDATEs, separate txns, missing indexes, rules 3×, cleanSessions, memory cache |
| Low | 10 | deadlinePassed bug, third_place typo, no reset, no audit, dead code, mixed langs, no types, no tests |
