# world-cup-pool — project guardrails

Live WC2026 betting pool. SvelteKit + Vite, PostgreSQL on **Neon**.

## ⚠️ PRODUCTION IS LIVE — read this before touching data
- `.env`'s `DATABASE_URL` points at the **live Neon prod database** (`…neon.tech`). It holds **real bets placed by real people**. Bets are now frozen (no new bets), but the data is irreplaceable.
- **NEVER run these against prod** — they WRITE/overwrite and can destroy the frozen bets:
  - `npm run migrate`, `npm run seed`, `npm run seed:matches`, `npm run setup` (setup = migrate + seed + seed:matches)
- When debugging anything that touches prod, stay **read-only**: SELECTs only, no INSERT/UPDATE/DELETE/DDL.
- To run destructive scripts safely, point `DATABASE_URL` at a **local/scratch DB** first and confirm the host is NOT `neon.tech`.
- There is one known-good backup snapshot taken after bets froze; do not assume you can casually re-create prod state.

## Known bug class to watch
- **Knockout bracket cascade / 3rd-place stale-pick bug**: when knockout results recascade, previously-made picks (especially 3rd-place) can go stale and silently mis-score. Any change to scoring/cascade logic MUST be covered by a regression test.

## Commands
- Dev: `npm run dev` · Build: `npm run build` · Typecheck: `npm run check`
- Tests: `npm test` (vitest) — integration tests live in `src/lib/server/*.integration.test.ts`
- Run the test suite after ANY change to scoring, cascade, or DB logic.

## For delegated workers (glm/minimax)
You do NOT have the human's session memory. Treat everything above as hard rules. If a task seems to require writing to prod, STOP and surface it rather than proceeding.
