# world-cup-pool — Design Review Findings

Comprehensive design review covering security, architecture, frontend/UX, and data
modeling. Each finding cites concrete `file_path:line_number` locations.

---

## 🔴 Security (highest priority)

### 1. Session tokens stored in plaintext
- **Location:** `drizzle/migrations/0001*.sql:126` (schema), `src/lib/server/queries.ts:401-406`
- **Issue:** `sessions.token` is stored as plaintext, while password-reset and
  email-verification tokens are SHA-256 hashed at rest. A read-only DB leak
  (backup, snapshot, SQL injection, misconfigured replica) would expose every
  active session token = **mass account hijack** for ~30 days (the cookie TTL).
- **Fix:** Hash `sessions.token` with SHA-256 (or HMAC-SHA256 with a server
  secret) before INSERT; compare hashes on lookup. Mirror the pattern already
  used in `password_reset_tokens` (migration `0013:4`).

### 2. Push unsubscribe endpoint doesn't verify ownership
- **Location:** `src/routes/api/push/unsubscribe/+server.ts:5-11`
- **Issue:** Any authenticated user who knows (or guesses) a push endpoint URL
  can unsubscribe anyone else. Low blast radius (DoS of notifications only) but
  it's a real authorization gap.
- **Fix:** Require `endpoint` to belong to `locals.user.id` before deleting.

### 3. Inconsistent authz on `admin/scoring`
- **Location:** `src/routes/api/admin/scoring/+server.ts:29` (GET) vs `:62` (POST)
- **Issue:** GET allows site admins OR pool owner; POST only allows pool owner.
  So a site admin can read scoring rules but cannot write them unless they own
  the pool. Almost certainly an unintentional discrepancy.
- **Fix:** Add `|| locals.user.is_admin` to the POST auth check.

### 4. In-process rate limiting & caching
- **Locations:** `src/lib/server/cache.ts:1-48`, `src/lib/server/rate-limit.ts:1-104`,
  `src/routes/api/auth/[action]/+server.ts:26-48`
- **Issue:** All limiters and caches are in-process `Map`s. The code documents
  this honestly and `cache.ts:26-48` even refuses to boot on detected
  multi-instance hosts (VERCEL, RAILWAY_REPLICA_COUNT, etc.) unless
  `ALLOW_MULTI_INSTANCE_CACHE=1`. But this is a hard ceiling on horizontal scale
  and silently weakens if you deploy >1 replica.
- **Fix (when scale demands):** Move to Redis (Upstash works well on HA add-ons)
  for both rate-limit counters and the session/leaderboard caches.

### 5. SSL `rejectUnauthorized: false`
- **Location:** `src/lib/server/db.ts:6-24`
- **Issue:** Acceptable for Neon with `sslmode=require`, but worth knowing — the
  client accepts any cert. Not exploitable in this deployment, but if the DB
  target ever changes, revisit.

---

## 🟠 Code organization & maintainability

### 6. No input-validation library
- **Locations:** `src/lib/server/json-body.ts:1-27` (the only shared helper),
  every `src/routes/api/**/+server.ts`
- **Issue:** Every endpoint hand-rolls `Number.isInteger(x) && x >= 0 && x <= 30`
  style checks. Parsed bodies are cast `as Record<string, any>` then probed at
  runtime. Type safety is weak; missing a check is easy.
- **Positive:** `asId()` (`json-body.ts:22-27`) is a thoughtful helper that
  addresses a real bug class (NaN/Infinity/hex reaching SQL int casts).
- **Fix:** Adopt **zod** (or valibot) and define one schema per endpoint.

### 7. The hub page is a 1,429-line mega-file
- **Location:** `src/routes/pool/[id]/+page.svelte:1-1429`
- **Issue:** Renders 8 client-side tabs (predictions, simulator, leaderboard,
  calendar, members, summary, results, scoring) plus bottom sheet, chat overlay,
  match-bets modal, and FABs — all in one file with ~250 lines of `<style>`.
- **Fix:** Introduce `src/routes/pool/[id]/+layout.svelte` for shared chrome
  (crumb, tabs, header) and extract each tab into its own component.

### 8. No SvelteKit form actions / `use:enhance`
- **Issue:** Confirmed: every form is `<form onsubmit={handleSubmit}>` +
  `e.preventDefault()` + hand-rolled `fetch`. No `actions` exports, no
  `use:enhance` anywhere in the repo. This discards SvelteKit's:
  - Progressive enhancement (forms work without JS)
  - Built-in CSRF protection on POST
  - `use:enhance` optimistic-update / invalidation plumbing
- **Examples:** `login/+page.svelte:32-67`, `forgot/+page.svelte:7-28`,
  `reset/+page.svelte:12-35`, `pools/create/+page.svelte:9-31`,
  `join/+page.svelte:7-29`, `profile/+page.svelte:21-100`

### 9. No `+error.svelte` and no `+loading.ts` anywhere
- **Issue:** Every uncaught error (including the carefully thrown 403/404 in
  `pool/[id]/+page.server.ts:18-30`) falls through to SvelteKit's default
  black-on-white page — jarring against this themed app. Navigation between the
  heavy hub and its sub-pages shows nothing during the SSR round-trip.
- **Fix:** Add at least a root `src/routes/+error.svelte`, plus
  `+loading.ts` (or `+layout.svelte` loading slot) for the pool section.

### 10. Pervasive duplication
- `phaseLabels` map defined **5 times** (`pool/[id]/+page.svelte:195-199`,
  `:404-412`, `results/+page.svelte:7-17`, `summary/+page.svelte:5-8`,
  `s/[code]/+page.svelte:4-7`).
- Date formatting (`Intl.DateTimeFormat('es-ES', …)`) rewritten **6+ times**
  (`summary/+page.svelte:46-49`, `stats/+page.svelte:25-28`,
  `h2h/+page.svelte:30-33`, `Simulator.svelte:26-29`,
  `predict/+page.svelte:75-79`, `pool/[id]/+page.svelte:257-258`,
  `results/+page.svelte:227`).
- Dense-ranking ("1-2-2-3") algorithm duplicated
  (`pool/[id]/+page.svelte:90-100` ≡ `s/[code]/+page.svelte:12-22`).
- "Create entry" + "Copy entry" UI/logic near-verbatim between
  `predict/+page.svelte:486-536` and `bracket/+page.svelte:860-905`.
- Inline stat-card markup repeated 4× in `admin/+page.svelte:369-384`, 3× in
  `+page.svelte:107-118` — despite an unused global `.stat-card` class
  (`app.css:432`).
- Avatar/medal rendering duplicated between `pool/[id]/+page.svelte:699` and
  `s/[code]/+page.svelte:57`.
- `fmtMoney` defined locally in `pool/[id]/+page.svelte:142-143`; admin page
  instead inlines `amount.toFixed(2) + '€'` (`admin/+page.svelte:408,419`) —
  hardcoding EUR and diverging.
- Back-link + H1 page header pattern copied into every pool sub-page.
- **Fix:** Extract all of the above into `$lib` helpers / components.

### 11. No component library
- **Issue:** No `src/lib/components/` directory. No reusable `<Card>`,
  `<Button>`, `<Badge>`, `<Modal>`, `<Sheet>`, `<Skeleton>`, `<Avatar>`,
  `<PageHeader>`. Everything is a one-off `<div style="background: var(--bg-card);
  border: 1px solid var(--border); border-radius: 8px; padding: 12px;">`.
- **Consequence:** Visual consistency changes (e.g. "card padding 12 → 14") are
  multi-file find-replace. `'Libre Baskerville'` is hand-applied 22 times for
  headings instead of via a `.h1` / `.title` class.

### 12. Tailwind installed but barely used
- **Issue:** `vite.config.ts:6` loads `@tailwindcss/vite` and `app.css:36` does
  `@import "tailwindcss";` — but **zero** Tailwind utility classes appear in
  `.svelte` files. The codebase is effectively plain CSS + CSS custom
  properties + heavy inline `style="…"` attributes.
- **Decision point:** Either commit to Tailwind utilities or remove the plugin.

### 13. Mobile-first via duplication, not responsive systems
- **Examples:** Home page (`+page.svelte:124-137`) renders **two entirely
  separate markup trees** — `.home-hero-mobile` + `.home-hero-desktop`,
  `.pool-list-mobile` + `.pool-grid-desktop` — toggled by media queries. Same
  pattern in `+layout.svelte` (mobile top bar `:280` + desktop sidebar `:311`).
- **Fix:** Single source of truth via container queries or component variants.

### 14. Dead code
- `src/lib/stores/header.js` — `headerTitle` writable is `.set(...)` in
  `pool/[id]/+page.svelte:169-172` and `bracket/+page.svelte:14-17` but
  `$headerTitle` is **never read** anywhere. Documented as dead in
  `docs/archive/AUDIT-GENERAL-OPINION.md:581`. Delete.
- `/bracket` route (`bracket/+page.svelte`) — 9-line "próximamente" stub,
  nothing in the UI links to it. The real bracket lives at `/pool/[id]/bracket`.
  Delete.

### 15. Hub `summary` / `results` tabs vs dedicated routes overlap
- The hub has its own in-page summary tab (`pool/[id]/+page.svelte:1014-1088`)
  and results tab (`:1090-1182`), **and** there are dedicated routes
  (`/pool/[id]/summary`, `/pool/[id]/results`) doing the same thing slightly
  differently. Relationship unclear to users; code largely duplicated.

### 16. No UI tests
- The `src/tests/` tree and `*.integration.test.ts` cover server logic only.
  `playwright` is a devDependency and there are several ad-hoc `.mjs` scripts at
  the repo root (`test-mobile.mjs`, `test-dnd.mjs`, etc.) — throwaway QA
  scripts, not a suite.

---

## 🟡 Data model

### 17. `has_paid` denormalized across two tables
- **Locations:** `pool_members.has_paid` AND `predictions.has_paid`;
  dual-write in `src/routes/api/admin/payment/+server.ts:50-57`;
  read via `COALESCE(pr.has_paid, pm.has_paid, FALSE)` in
  `src/lib/server/queries.ts:317-331`.
- **Issue:** App-level dual-write keeps them in sync, but there is **no DB-level
  guarantee** they agree. Classic drift hazard.
- **Fix:** Pick one source of truth; the other becomes derived/cached, or add a
  trigger/constraint.

### 18. `matches.fifa_id` has no UNIQUE constraint
- **Locations:** partial index only (`drizzle/migrations/0003*.sql:2`),
  ingested at `src/lib/server/live-scores.ts:368`.
- **Issue:** Two rows could claim the same external id. `ingestMatch` does
  `SELECT … WHERE fifa_id = $1 LIMIT 1`, so duplicates would be **silently
  ignored** rather than rejected.
- **Fix:** Add `UNIQUE` constraint (the partial index could become a unique
  partial index).

### 19. `app.d.ts` types `is_admin` as `number`, but Postgres returns boolean
- **Location:** `src/app.d.ts:9`
- **Issue:** The type lies. Nothing breaks today because call sites use truthy
  checks, but it's latent type unsoundness waiting to bite.

### 20. `group_predictions.position_1..4` as repeated columns
- **Location:** `drizzle/migrations/0001*.sql:90`
- **Issue:** Rather than a normalized `(prediction_id, group_name, position,
  team_id)` child table. Acceptable for fixed-size-4 structure but makes
  aggregate SQL awkward.

### 21. `audit_log.user_id` FK without `ON DELETE`
- **Location:** `drizzle/migrations/0005*.sql:3`
- **Issue:** `REFERENCES users(id)` without cascade clause, so deleting a user
  fails on audit rows. Arguably desirable (audit immutability) but inconsistent
  with the CASCADE pattern used elsewhere.

### 22. N+1 in bracket POST
- **Location:** `src/routes/api/predictions/bracket/+server.ts:222-243`
- **Issue:** One `SELECT slot, team_id FROM bracket_predictions …` per phase to
  detect post-save duplicates — up to 6 sequential round-trips per save.
- **Fix:** Single query with `WHERE phase = ANY(…) GROUP BY phase`.

### 23. Two SQL interpolations to audit (currently safe, fragile)
- `src/routes/api/admin/scoring/+server.ts:98` — `UPDATE pools SET
  ${updates.join(', ')} WHERE id = $${paramIdx}`. Safe because `updates` is built
  from static literals, but a future edit could accidentally interpolate user
  input.
- `src/lib/server/backup.ts:51` — `SELECT * FROM "${table_name}"` where
  `table_name` comes from `information_schema.tables`. Documented as safe.
- **Note:** All other queries use `$1, $2, …` placeholders correctly.

---

## 🟢 Things done well (preserve these)

- **Scoring correctness:** `calculateAllScores` runs inside a per-pool
  `pg_advisory_xact_lock` (`src/lib/server/scoring.ts:380`) with idempotent
  zero-then-recompute (`:45-51`, `:142-148`, `:275-281`). Regression coverage
  exists (`scoring.test.ts` is 538 lines).
- **Password hashing:** scrypt + 16-byte salt + 64-byte key + `timingSafeEqual`
  (`queries.ts:7-25`). Solid.
- **CSRF defense-in-depth:** explicit cross-origin check on every state-changing
  `/api/` request on top of `sameSite=lax` (`hooks.server.ts:40-101`).
- **3rd-place stale-pick handling:** validates against `qf` not `sf`
  (`bracket/+server.ts:247-258`) with a long explanatory comment — exactly the
  bug class CLAUDE.md warns about.
- **R32 wildcard "occupant" guard:** prevents phantom R32 points for
  non-advanced occupants (`scoring.ts:196-218`).
- **Bulk scoring UPDATEs** via `unnest()` (`scoring.ts:123-127,252-256,350-354`)
  — explicit "M3" optimization.
- **Error pattern:** opaque `ERR_XXXXXXXX` correlation codes surfaced to client,
  full stack trace server-side (`err-code.ts:3-5`). Consistent and clean.
- **Mobile polish (strongest UI area):** safe-area insets, pull-to-refresh with
  swipe-rejection, auto-hide top bar, haptic feedback, portrait-only overlay,
  iOS 16px input-zoom prevention, 44×44 touch targets, adaptive live-score
  polling cadence (30s live / 60s pre-kickoff / 5min idle, paused when hidden,
  stopped outside tournament window).
- **Autosave UX:** debounced (600ms) with on-screen "Guardando… / ✓ Guardado"
  and flush-on-unmount so a pick made <600ms before navigating isn't dropped
  (`predict/+page.svelte:333-390`).
- **Account enumeration prevented:** forgot-password always returns generic
  success (`auth/forgot/+server.ts:23-55`).
- **TOCTOU-safe pool join:** catches `23505` unique violation
  (`queries.ts:285-293`); entry creation uses `SELECT … FOR UPDATE`
  (`predictions/entry/+server.ts:46-61`).

---

## Recommended priorities (top 5)

1. **Hash session tokens at rest** (security, ~30 LOC, low risk)
2. **Adopt zod for request validation** (eliminates whole bug classes)
3. **Split hub page + extract a small component library** (maintainability)
4. **Add `+error.svelte` and `+loading.ts`** (UX polish, quick win)
5. **Add UNIQUE constraint on `matches.fifa_id`** (data integrity, one migration)

---

*Review conducted by glm on Sat Jul 11 2026. Based on static analysis of the
repository at `/Users/jsr/world-cup-pool`. All findings are advisory; verify
against the live codebase before acting.*
