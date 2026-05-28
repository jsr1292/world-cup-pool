# FIX-PLAN-GENERAL.md

Generated 2026-05-28 against branch `master` at `132cdf7`.
Covers: C1–C3, H1–H10, M1–M28.
Skips: LOW (L*) and OPINION (O*) findings.

Tab-indented code throughout. Apply waves in order; within each wave apply fixes in any order.

---

## Wave 1 — Independent safe fixes

No cross-file or schema dependencies. Each fix is self-contained.

---

### C1 — Toast UI never renders

**File:** `src/routes/+layout.svelte`

Add import in `<script>` block (line 6, after the existing imports):

```svelte
// OLD (no toast import exists)
	import { page } from '$app/stores';

// NEW
	import { page } from '$app/stores';
	import { toast } from '$lib/toast.js';
```

Add renderer at the very end of the template, before the closing `</div>` of `.app-layout`:

```svelte
// OLD (nothing — no toast renderer exists)
</div>

// NEW
	{#if $toast}
		<div class="toast">{$toast}</div>
	{/if}
</div>
```

The `.toast` CSS class already exists in `src/app.css:20–30`. No CSS changes needed.

---

### C3 — Shutdown handler can reopen pool mid-drain

**File:** `src/lib/server/db.ts`

```ts
// OLD
let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!_pool) {

// NEW
let _pool: pg.Pool | null = null;
let _shuttingDown = false;

export function getPool(): pg.Pool {
	if (_shuttingDown) throw new Error('[db] Server is shutting down — refusing new connections');
	if (!_pool) {
```

```ts
// OLD
async function shutdown() {
	if (_pool) {
		try {
			await _pool.end();
			console.log('[db] Pool closed gracefully');
		} catch (e) {
			console.error('[db] Error closing pool:', e);
		}
		_pool = null;
	}
}

// NEW
async function shutdown() {
	if (_pool) {
		_shuttingDown = true;
		try {
			await _pool.end();
			console.log('[db] Pool closed gracefully');
		} catch (e) {
			console.error('[db] Error closing pool:', e);
		}
		// Do NOT null _pool — future query() calls now throw via _shuttingDown
		// rather than silently creating a new pool against the draining server.
	}
}
```

---

### H1 — match-scores returns `200 ok: true` on scoring failure

**File:** `src/routes/api/predictions/match-scores/+server.ts`

```ts
// OLD  (lines 144–148)
  } catch (e) {
    console.error('[score] match-scores pool', poolId, e);
    // Fall through — we already saved the prediction; the next sync will
    // reconcile points_earned. Surface the error code, not a generic 500.
    return json({ ok: true, scoring: 'failed' });
  }

// NEW
  } catch (e) {
    console.error('[score] match-scores pool', poolId, e);
    return json({ ok: false, error: 'Predicción guardada, pero el cálculo de puntos falló', scoring: 'failed' }, { status: 500 });
  }
```

---

### H7 — `seed.ts` exits the process on import

**File:** `src/lib/server/seed.ts`

```ts
// OLD  (lines 131–136)
seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });

// NEW
if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
```

---

### H9 — Currency hardcoded to `€` ignoring per-pool `currency` column

**File:** `src/routes/+page.svelte`

Mobile list (line 67):
```svelte
// OLD
                  {pool.buy_in > 0 ? ` · ${pool.buy_in}€` : ''}

// NEW
                  {pool.buy_in > 0 ? ` · ${pool.buy_in} ${pool.currency ?? 'EUR'}` : ''}
```

Desktop card (line 83):
```svelte
// OLD
                    {pool.buy_in > 0 ? ` · 💰 ${pool.buy_in}€` : ''}

// NEW
                    {pool.buy_in > 0 ? ` · 💰 ${pool.buy_in} ${pool.currency ?? 'EUR'}` : ''}
```

---

### M12 — Spinner animation `spin` is undefined

**File:** `src/app.css`

Add after the existing `@keyframes shimmer` block (line 11):

```css
// OLD  (no @keyframes spin exists anywhere)
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

// NEW
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

---

### M14 — `isDark` initializes to `true` causing one-frame icon flash

`src/app.html` already has an inline script that sets `data-theme` before render (line 17). Read that attribute synchronously to initialize state.

**File:** `src/routes/+layout.svelte`

```ts
// OLD  (lines 26–30)
  let isDark = $state(true);
  $effect(() => {
    if (!browser) return;
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  });

// NEW
  let isDark = $state(
    browser ? document.documentElement.getAttribute('data-theme') !== 'light' : true
  );
  $effect(() => {
    if (!browser) return;
    isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  });
```

---

### M17 — Correlation codes use `Math.random()` and are not applied uniformly

**New file:** `src/lib/server/err-code.ts`

```ts
import { randomBytes } from 'crypto';

export function errCode(): string {
	return `ERR_${randomBytes(4).toString('hex').toUpperCase()}`;
}
```

Then in every file that currently generates a code with `Math.random().toString(36).slice(2, 10)`, replace:

```ts
// OLD  (pattern used in bracket/+server.ts, sync-scores/+server.ts, results/+server.ts, etc.)
const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

// NEW
import { errCode } from '$lib/server/err-code.js';
const code = errCode();
```

Files to update:
- `src/routes/api/predictions/bracket/+server.ts` (lines 38, 231)
- `src/routes/api/admin/sync-scores/+server.ts` (line 67)
- `src/routes/api/admin/results/+server.ts` (line 84)
- Any other `+server.ts` that uses the pattern

---

### M22 — Font sizes 8–9 px fail WCAG readability

**File:** `src/app.css`

```css
/* OLD  (line 204) */
.bottom-nav a {
  ...
  font-size: 8px;
  letter-spacing: 0.06em;

/* NEW */
.bottom-nav a {
  ...
  font-size: 11px;
  letter-spacing: 0.03em;
```

Any `.nav-label` or `.stat-label` rules also at 9 px:

```css
/* OLD */
.nav-label { font-size: 9px; letter-spacing: 0.05em; }
.stat-label { font-size: 9px; letter-spacing: 0.12em; }

/* NEW */
.nav-label { font-size: 11px; letter-spacing: 0.04em; }
.stat-label { font-size: 11px; letter-spacing: 0.06em; }
```

---

### M23 — `transition: all` on `.pool-card` causes jank on iOS

**File:** `src/app.css` (line 356)

```css
/* OLD */
  transition: all 0.2s, background-color 0.3s ease, border-color 0.3s ease;

/* NEW */
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s, background-color 0.3s ease;
```

---

### M28 — Kickoff timestamp hardcoded in three places

**New file:** `src/lib/constants.ts`

```ts
export const WORLD_CUP_KICKOFF = new Date('2026-06-11T17:00:00Z');
export const WORLD_CUP_KICKOFF_MS = WORLD_CUP_KICKOFF.getTime();
export const WORLD_CUP_DURATION_MS = 1000 * 60 * 60 * 24 * 35;
```

**File:** `src/routes/+page.server.ts`

```ts
// OLD
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  ...
  const kickoff = new Date('2026-06-11T17:00:00Z');

// NEW
import type { PageServerLoad } from './$types.js';
import { WORLD_CUP_KICKOFF } from '$lib/constants.js';

export const load: PageServerLoad = async ({ locals }) => {
  ...
  const kickoff = WORLD_CUP_KICKOFF;
```

**File:** `src/routes/+layout.svelte`

```ts
// OLD  (line 36 in <script>)
    const kickoff = new Date('2026-06-11T17:00:00Z').getTime();

// NEW  (add import near top of <script>, update usage)
  import { WORLD_CUP_KICKOFF_MS, WORLD_CUP_DURATION_MS } from '$lib/constants.js';
  ...
    const kickoff = WORLD_CUP_KICKOFF_MS;
```

```svelte
// OLD  (line 121 in template)
            {@const diff = new Date('2026-06-11T17:00:00Z').getTime() - Date.now()}
            {#if diff > -(1000 * 60 * 60 * 24 * 35)}

// NEW
            {@const diff = WORLD_CUP_KICKOFF_MS - Date.now()}
            {#if diff > -WORLD_CUP_DURATION_MS}
```

---

## Wave 2 — Schema/logic changes

Apply in the sub-order below; migrations must run before code that depends on them.

---

### C2 — `Pool` interface fields don't match the DB schema

**File:** `src/lib/server/types.ts`

```ts
// OLD
export interface Pool {
  id: number;
  name: string;
  invite_code: string;
  share_token: string;
  created_by: number;
  buy_in: number;
  allow_multiple: boolean;
  is_active: boolean;          // B3-5: campo presente en la BD pero faltaba en el tipo
  deadline_group: Date | null;
  deadline_knockout: Date | null;
  status: string;
  last_scored_at: Date | null;
  last_score_error: string | null;
  created_at: Date;
}

// NEW
export interface Pool {
  id: number;
  name: string;
  invite_code: string;
  share_token: string;
  created_by: number;
  buy_in: number;
  currency: string;
  allow_multiple_predictions: boolean;
  is_active: boolean;
  deadline_group: Date | null;
  deadline_knockout: Date | null;
  last_scored_at: Date | null;
  last_score_error: string | null;
  created_at: Date;
}
```

Note: `status` did not exist on the `pools` table in any migration — remove it. `currency` is present in `0001_initial.sql` and was missing from the type — add it. `allow_multiple` renamed to `allow_multiple_predictions` to match the actual column. After this change, grep for `pool.allow_multiple` and `pool.status` (on Pool objects) across the codebase and update each callsite.

---

### H2 — Bracket phase check depends on object-iteration order

**File:** `src/routes/api/predictions/bracket/+server.ts`

Hoist the dropped-phases tracker before the phase-started block (after line 60, `const picks = { ...rawPicks };`):

```ts
// OLD  (nothing here)
  const picks = { ...rawPicks }; // mutable copy so we can delete started phases

// NEW
  const picks = { ...rawPicks }; // mutable copy so we can delete started phases
  const droppedPhases: string[] = [];
```

Replace the phase-filtering loop (lines 119–122):

```ts
// OLD
    const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
    for (const p of startedPhaseSet) {
      delete (picks as Record<string, unknown>)[p];
    }

// NEW
    const startedPhaseSet = new Set(startedRows.map((r: any) => r.phase));
    for (const p of startedPhaseSet) {
      delete (picks as Record<string, unknown>)[p];
      droppedPhases.push(p);
    }
```

Replace the cross-phase consistency loop (lines 186–207). Sort picks into canonical order and return 400 (not a silent skip) when preceding phase is missing while the user IS saving a downstream phase:

```ts
// OLD
  for (const [phase, slots] of Object.entries(picks)) {
    const precedingPhase = PHASE_PROGRESSION[phase];
    if (!precedingPhase) continue;

    const teamsInThisPhase = new Set(
      Object.values(slots).filter((id): id is number => id !== null)
    );
    const teamsInPrecedingPhase = await getPrecedingTeams(precedingPhase);

    // If we still have no preceding-phase data (truly empty), skip the check
    // — there's nothing to validate against and we don't want to block a
    // legitimate first-time save of just the final.
    if (teamsInPrecedingPhase.size === 0) continue;

    for (const teamId of teamsInThisPhase) {
      if (!teamsInPrecedingPhase.has(teamId)) {
        return json({
          error: `Equipo ${teamId} no fue seleccionado en la fase previa (${precedingPhase})`,
        }, { status: 400 });
      }
    }
  }

// NEW
  const CANONICAL_PHASE_ORDER = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];
  const sortedPickEntries = Object.entries(picks).sort(
    ([a], [b]) => CANONICAL_PHASE_ORDER.indexOf(a) - CANONICAL_PHASE_ORDER.indexOf(b)
  );
  for (const [phase, slots] of sortedPickEntries) {
    const precedingPhase = PHASE_PROGRESSION[phase];
    if (!precedingPhase) continue;

    const teamsInThisPhase = new Set(
      Object.values(slots).filter((id): id is number => id !== null)
    );
    if (teamsInThisPhase.size === 0) continue;

    const teamsInPrecedingPhase = await getPrecedingTeams(precedingPhase);

    if (teamsInPrecedingPhase.size === 0) {
      return json({
        error: `No hay selecciones previas en (${precedingPhase}) para validar ${phase}`,
      }, { status: 400 });
    }

    for (const teamId of teamsInThisPhase) {
      if (!teamsInPrecedingPhase.has(teamId)) {
        return json({
          error: `Equipo ${teamId} no fue seleccionado en la fase previa (${precedingPhase})`,
        }, { status: 400 });
      }
    }
  }
```

Replace the final success return (line 228) to surface dropped phases:

```ts
// OLD
    return json({ ok: true });

// NEW
    return json({ ok: true, dropped: droppedPhases });
```

---

### H3 — `setImmediate` rescoring lost on process crash

**File:** `src/routes/api/admin/results/+server.ts`

Replace the `setImmediate` block (lines 69–82):

```ts
// OLD
    setImmediate(async () => {
      for (const poolId of poolIds) {
        try {
          await calculateAllScores(poolId);
          invalidateCachedPoolLeaderboard(poolId);
          invalidateCachedPoolResults(poolId);
        } catch (e) {
          console.error(`[bg-score] admin/results pool ${poolId}:`, e);
        }
      }
      invalidateGlobalLeaderboard();
    });

    return json({ ok: true, scoring: 'pending' });

// NEW
    for (const poolId of poolIds) {
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[score] admin/results pool ${poolId}:`, e);
      }
    }
    invalidateGlobalLeaderboard();

    return json({ ok: true });
```

**File:** `src/routes/api/admin/sync-scores/+server.ts`

Replace the `setImmediate` block (lines 43–63):

```ts
// OLD
      setImmediate(async () => {
        await runWithConcurrency(poolIds, SCORE_CONCURRENCY, async (poolId) => {
          // §3.7 — Re-check is_active before each scoring pass: the pool may
          // have been disabled or deleted while the previous batch was running.
          const { rows: stillActive } = await query(
            'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
            [poolId]
          );
          if (stillActive.length === 0) return;

          try {
            await calculateAllScores(poolId);
            invalidateCachedPoolLeaderboard(poolId);
            invalidateCachedPoolResults(poolId);
          } catch (e) {
            console.error(`[bg-score] sync-scores pool ${poolId}:`, e);
          }
        });
        invalidateGlobalLeaderboard();
      });

// NEW
      await runWithConcurrency(poolIds, SCORE_CONCURRENCY, async (poolId) => {
        const { rows: stillActive } = await query(
          'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
          [poolId]
        );
        if (stillActive.length === 0) return;

        try {
          await calculateAllScores(poolId);
          invalidateCachedPoolLeaderboard(poolId);
          invalidateCachedPoolResults(poolId);
        } catch (e) {
          console.error(`[score] sync-scores pool ${poolId}:`, e);
        }
      });
      invalidateGlobalLeaderboard();
```

---

### H4 — CORS origin check ignores scheme

**File:** `src/hooks.server.ts`

Replace the `normalize` function (lines 30–43):

```ts
// OLD
      const normalize = (u: string) => {
        try {
          const url = new URL(u);
          // Map all loopback variants to localhost
          if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) {
            url.hostname = 'localhost';
          }
          // In dev/behind-proxy, event.url.origin may use https while browser uses http
          // (or vice versa). For same-host requests, scheme doesn't matter.
          return `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
        } catch {
          return u;
        }
      };

// NEW
      const normalize = (u: string): string => {
        try {
          const url = new URL(u);
          // Collapse loopback variants so dev still works regardless of which
          // bind address the browser sees. Force http so both sides agree.
          if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)) {
            url.hostname = 'localhost';
            url.protocol = 'http:';
          }
          return url.origin; // scheme + hostname + port — full comparison
        } catch {
          return u;
        }
      };
```

---

### H5 — Rate-limit maps not gated by multi-instance boot guard

**File:** `src/lib/server/rate-limit.ts`

Add immediately after the module-level constant declarations (after `const AUTH_WINDOW = 15 * 60 * 1000;`):

```ts
// OLD  (nothing — no multi-instance warning exists)
const _authLimits = new Map<number, { count: number; resetAt: number }>();
const AUTH_LIMIT = 5;
const AUTH_WINDOW = 15 * 60 * 1000;

// NEW
const _authLimits = new Map<number, { count: number; resetAt: number }>();
const AUTH_LIMIT = 5;
const AUTH_WINDOW = 15 * 60 * 1000;

if (process.env.VERCEL || process.env.RAILWAY_REPLICA_COUNT || process.env.FLY_APP_NAME) {
	console.warn(
		'[rate-limit] In-process rate limits are per-instance and will NOT be shared across ' +
		'replicas. Migrate to a shared store (Postgres rate_limits table or Redis) before ' +
		'scaling horizontally.'
	);
}
```

---

### H6 — Default scoring rules defined in two places

**File:** `src/lib/server/scoring.ts`

Export the constant (line 4):

```ts
// OLD
const DEFAULT_RULES: Record<string, number> = {

// NEW
export const DEFAULT_SCORING_RULES: Record<string, number> = {
```

Update internal reference in the same file (line 20):

```ts
// OLD
	const config: Record<string, number> = { ...DEFAULT_RULES };

// NEW
	const config: Record<string, number> = { ...DEFAULT_SCORING_RULES };
```

**File:** `src/lib/server/queries.ts`

Add import at top (after existing imports):

```ts
// OLD
import { invalidateCachedSession, getAllTeamsCached } from './cache.js';

// NEW
import { invalidateCachedSession, getAllTeamsCached } from './cache.js';
import { DEFAULT_SCORING_RULES } from './scoring.js';
```

Replace the inline defaults block (lines 92–106):

```ts
// OLD
    // Default scoring config
    const defaults = [
      ['match_outcome', 1],
      ['exact_score', 3],
      ['group_position', 2],
      ['knockout_r32', 2],
      ['knockout_r16', 3],
      ['knockout_qf', 4],
      ['knockout_sf', 6],
      ['knockout_final', 6],
      ['third_place', 6],
      ['knockout_winner', 8],
    ];
    for (const [rule, pts] of defaults) {
      await client.query('INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)', [poolId, rule, pts]);
    }

// NEW
    for (const [rule, pts] of Object.entries(DEFAULT_SCORING_RULES)) {
      await client.query('INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)', [poolId, rule, pts]);
    }
```

---

### H8 — `flagEmoji` / `shortName` duplicated across three components

**New file:** `src/lib/teams.ts`

```ts
export function flagEmoji(code: string): string {
	if (!code) return '';
	if (code === 'ENG') return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
	if (code === 'SCT') return '🏴󠁧󠁢󠁳󠁣󠁴󠁿';
	if (code.length !== 2) {
		console.warn('[flagEmoji] unknown flag code:', code);
		return '🏳️';
	}
	return code
		.toUpperCase()
		.split('')
		.map(c => String.fromCodePoint(c.codePointAt(0)! + 127397))
		.join('');
}

export function shortName(name: string): string {
	const MAP: Record<string, string> = {
		'United States': 'USA',
		'South Korea': 'S. Korea',
		'South Africa': 'S. Africa',
		"Ivory Coast": "Côte d'Ivoire",
		'New Zealand': 'N. Zealand',
		'Cape Verde': 'Cape Verde',
		'Czech Republic': 'Czechia',
		'Saudi Arabia': 'S. Arabia',
		'Bosnia and Herzegovina': 'Bosnia',
		'DR Congo': 'DR Congo',
		'North Macedonia': 'N. Macedonia',
	};
	return MAP[name] ?? (name ? name.substring(0, 14) : '');
}
```

Then in each of the three pages, remove the local `flagEmoji` / `shortName` / `flag` definitions and replace with the import:

**`src/routes/pool/[id]/bracket/+page.svelte`** — remove lines 576–599 and add:

```ts
// OLD  (lines 576–599)
  function flagEmoji(code) { ... }
  function shortName(name) { ... }

// NEW (in <script>)
  import { flagEmoji, shortName } from '$lib/teams.js';
```

**`src/routes/pool/[id]/predict/+page.svelte`** — remove local `flagEmoji` / `shortName` definitions and add the same import.

**`src/routes/pool/[id]/+page.svelte`** — remove local `flag` function (lines 27–32) and the inline `teamFlag` helper, replace with:

```ts
// OLD  (lines 27–32)
  function flag(code: string) {
    if (!code) return '';
    if (code === 'ENG') return '...';
    if (code === 'SCT') return '...';
    return code.toUpperCase().replace(/./g, c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65));
  }

// NEW
  import { flagEmoji } from '$lib/teams.js';
```

Update all callsites in that file from `flag(...)` to `flagEmoji(...)`.

---

### H10 — Bracket server silently drops started phases with no signal to UI

Already handled in **H2** above by hoisting `droppedPhases` and returning it in the success response. No additional change needed.

---

### M1 — No CHECK constraints on domain values

**New file:** `drizzle/migrations/0009_check_constraints.sql`

```sql
-- Add domain CHECK constraints missing from 0001_initial.sql

ALTER TABLE matches
  ADD CONSTRAINT chk_matches_home_score
    CHECK (home_score IS NULL OR (home_score >= 0 AND home_score <= 30)),
  ADD CONSTRAINT chk_matches_away_score
    CHECK (away_score IS NULL OR (away_score >= 0 AND away_score <= 30)),
  ADD CONSTRAINT chk_matches_phase
    CHECK (phase IN ('group','r32','r16','qf','sf','3rd','final')),
  ADD CONSTRAINT chk_matches_status
    CHECK (status IN ('scheduled','live','finished'));

ALTER TABLE match_predictions
  ADD CONSTRAINT chk_mp_home_score
    CHECK (home_score IS NULL OR (home_score >= 0 AND home_score <= 30)),
  ADD CONSTRAINT chk_mp_away_score
    CHECK (away_score IS NULL OR (away_score >= 0 AND away_score <= 30)),
  ADD CONSTRAINT chk_mp_points
    CHECK (points_earned >= 0);

ALTER TABLE predictions
  ADD CONSTRAINT chk_pred_total_score
    CHECK (total_score >= 0);

ALTER TABLE group_predictions
  ADD CONSTRAINT chk_gp_points
    CHECK (points_earned >= 0);

ALTER TABLE bracket_predictions
  ADD CONSTRAINT chk_bp_points
    CHECK (points_earned >= 0);
```

---

### M2 — Low-cardinality index on `pools.is_active`

Add to `drizzle/migrations/0009_check_constraints.sql` (same file as M1, apply together):

```sql
-- Replace boolean btree index with partial index on the minority value
DROP INDEX IF EXISTS idx_pools_is_active;
CREATE INDEX idx_pools_active ON pools (id) WHERE is_active = true;
```

---

### M3 — Missing composite index for leaderboard query

Add to `drizzle/migrations/0009_check_constraints.sql`:

```sql
-- Support ORDER BY total_score DESC, updated_at ASC within a pool
CREATE INDEX IF NOT EXISTS idx_predictions_leaderboard
  ON predictions (pool_id, total_score DESC, updated_at ASC);
```

---

### M4 — `audit_log` stores JSON as TEXT instead of JSONB

**New file:** `drizzle/migrations/0010_audit_jsonb.sql`

```sql
-- Convert audit_log JSON columns to JSONB for queryability
ALTER TABLE audit_log
  ALTER COLUMN old_value TYPE JSONB USING old_value::JSONB,
  ALTER COLUMN new_value TYPE JSONB USING new_value::JSONB;
```

**File:** `src/lib/server/audit.ts`

After this migration, pg will accept JS objects directly for JSONB columns. The existing `JSON.stringify` calls continue to work (pg coerces text to jsonb). No code change required unless you want to pass objects directly — that is optional cleanup.

---

### M8 — Migration 0006 in wrong directory

**Step 1 — move the file:**

```bash
mv src/lib/server/migrations/0006_penalty_winner.sql drizzle/migrations/0006_penalty_winner.sql
```

**Step 2 — simplify `migrate.ts`** (remove the second directory and the dedupe pass):

**File:** `src/lib/server/migrate.ts`

```ts
// OLD  (lines 48–75)
		// Collect SQL files from both directories
		const dirs = [
			join(projectRoot, 'drizzle/migrations'),
			join(__dirname, 'migrations'),
		];

		const files: { filename: string; fullPath: string }[] = [];

		for (const dir of dirs) {
			try {
				const entries = readdirSync(dir)
					.filter(f => f.endsWith('.sql'))
					.sort();
				for (const f of entries) {
					files.push({ filename: f, fullPath: join(dir, f) });
				}
			} catch (e: any) {
				if (e.code !== 'ENOENT') throw e;
				// Directory doesn't exist — skip silently
			}
		}

		// Deduplicate by filename in case of overlap; first occurrence wins
		const seen = new Set<string>();
		const uniqueFiles = files.filter(({ filename }) => {
			if (seen.has(filename)) return false;
			seen.add(filename);
			return true;
		});

		// Sort all collected files by filename so order is deterministic
		uniqueFiles.sort((a, b) => a.filename.localeCompare(b.filename));

// NEW
		const migrationsDir = join(projectRoot, 'drizzle/migrations');
		const entries = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
		const uniqueFiles = entries.map(f => ({ filename: f, fullPath: join(migrationsDir, f) }));
```

Update the downstream loop to use `uniqueFiles` (unchanged — same variable name).

---

### M9 — `migrate.ts` transactions span multiple pool connections

**File:** `src/lib/server/migrate.ts`

Replace the per-migration query block (lines 97–108):

```ts
// OLD
			await pool.query('BEGIN');
			try {
				await pool.query(sql);
				await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
				await pool.query('COMMIT');
				console.log(`[migrate] ✓     ${filename}`);
				applied++;
			} catch (e) {
				await pool.query('ROLLBACK');
				throw e;
			}

// NEW
			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				await client.query(sql);
				await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
				await client.query('COMMIT');
				console.log(`[migrate] ✓     ${filename}`);
				applied++;
			} catch (e) {
				await client.query('ROLLBACK');
				throw e;
			} finally {
				client.release();
			}
```

---

### M11 — Cache shape has no type guard against user-scoped data

**File:** `src/lib/server/cache.ts` (read first; add the type and assert in setter)

Find the `setCachedPoolResults` function and add a type assertion. First, define the cache shape at the top of the file:

```ts
// Add near the top of cache.ts, before the cache Map declarations
export type PoolResultsCache = {
	teams: unknown;
	matches: unknown;
	groupStandings: unknown;
	phaseResults: unknown;
	// add other non-user-scoped fields as needed
	// MUST NOT contain: userId, prediction_id, predictions, user*
};

// In setCachedPoolResults, add a runtime guard in dev:
export function setCachedPoolResults(poolId: number, data: PoolResultsCache): void {
	if (process.env.NODE_ENV !== 'production') {
		const forbidden = ['userId', 'prediction_id', 'predictions', 'userGroupPreds', 'userBracketPreds'];
		for (const key of forbidden) {
			if (key in (data as Record<string, unknown>)) {
				throw new Error(`[cache] setCachedPoolResults must not contain user-scoped key: ${key}`);
			}
		}
	}
	// ... existing cache.set(poolId, data) logic
}
```

---

### M15 — `selections` clobbered on every parent navigation

**File:** `src/routes/pool/[id]/predict/+page.svelte`

Track which groups the user has edited locally so parent invalidations don't revert them mid-save:

```ts
// OLD  (lines 62–63)
  let selections = $state({});
  $effect(() => { selections = JSON.parse(JSON.stringify(selectionsInit)); });

// NEW
  let selections = $state(JSON.parse(JSON.stringify(selectionsInit)));
  const _dirtyGroups = new Set<string>();

  $effect(() => {
    const fresh = JSON.parse(JSON.stringify(selectionsInit)) as Record<string, (number | null)[]>;
    for (const [group, ranks] of Object.entries(fresh)) {
      if (!_dirtyGroups.has(group)) {
        selections[group] = ranks;
      }
    }
  });
```

Then wherever `tapTeam` or `resetGroup` modifies `selections`, also mark the group dirty:

```ts
// In tapTeam (after line 89: selections[group] = arr;)
    selections[group] = arr;
    _dirtyGroups.add(group);
    autoSave();

// In resetGroup (after line 94: selections[group] = [null, null, null, null];)
    selections[group] = [null, null, null, null];
    _dirtyGroups.delete(group); // user explicitly cleared — no longer dirty
    autoSave();
```

After a successful save response, clear dirty state:

```ts
// In the save success branch (wherever the POST response is handled):
    _dirtyGroups.clear();
```

---

### M16 — `request.json()` not wrapped; malformed body produces 500

For every `+server.ts` that calls `await request.json()` directly, wrap it:

Pattern to apply in each file (`group/+server.ts`, `bracket/+server.ts`, `auth/[action]/+server.ts`, `admin/results/+server.ts`, etc.):

```ts
// OLD  (example from bracket/+server.ts line 55)
  const body = await request.json();

// NEW
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON inválido en el cuerpo de la petición' }, { status: 400 });
  }
```

Files to update:
- `src/routes/api/predictions/bracket/+server.ts` (line 55)
- `src/routes/api/predictions/group/+server.ts` (line ~57)
- `src/routes/api/predictions/match-scores/+server.ts` (line 17)
- `src/routes/api/auth/[action]/+server.ts` (line ~44)
- `src/routes/api/admin/results/+server.ts` (line 14)
- Any other admin or prediction route that calls `request.json()`

---

### M19 — `publicPaths` prefix matching catches unintended routes

**File:** `src/hooks.server.ts`

```ts
// OLD  (line 12)
const publicPaths = ['/login', '/register', '/api/auth', '/leaderboard', '/join', '/s/', '/api/health'];

// NEW
const publicPaths = new Set(['/login', '/register', '/leaderboard', '/api/health']);
const publicPathPrefixes = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/join',
  '/s/',
];
```

```ts
// OLD  (line 94)
  if (publicPaths.some(p => path.startsWith(p))) return resolve(event);

// NEW
  if (publicPaths.has(path) || publicPathPrefixes.some(p => path.startsWith(p))) return resolve(event);
```

---

### M25 — Live-scores FIFA fallback runs silently with stub stage IDs

**File:** `src/lib/server/live-scores.ts`

Add a startup check near the top of the module (after imports, before function definitions):

```ts
// Add after imports
const _provider = process.env.API_FOOTBALL_KEY
  ? 'api-football'
  : process.env.ENABLE_FIFA_FALLBACK
    ? 'fifa-stub'
    : 'none';
console.log(`[live-scores] provider: ${_provider}`);
if (_provider === 'none') {
  console.warn('[live-scores] No API_FOOTBALL_KEY and ENABLE_FIFA_FALLBACK not set — syncScores() will return 0 matches.');
}
```

In the FIFA fallback branch (wherever the FIFA path executes when `API_FOOTBALL_KEY` is absent), gate it explicitly:

```ts
// OLD  (wherever the FIFA fetch is attempted without the API key)
// ... FIFA fetch code runs ...

// NEW — guard the entire FIFA path
if (!process.env.ENABLE_FIFA_FALLBACK) {
  console.warn('[live-scores] FIFA fallback disabled. Set ENABLE_FIFA_FALLBACK=1 to enable.');
  return { updated: 0, skipped: 0, errors: 0 };
}
// ... existing FIFA fetch code ...
```

---

### M26 — `team_aliases` table referenced in live-scores but never created

**New file:** `drizzle/migrations/0011_team_aliases.sql`

```sql
CREATE TABLE IF NOT EXISTS team_aliases (
  id           SERIAL PRIMARY KEY,
  team_id      INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  alias_normalized TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (alias_normalized)
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_norm ON team_aliases (alias_normalized);
```

No code changes needed — the query in `live-scores.ts:160–173` already uses this table correctly once it exists.

---

## Wave 3 — Larger refactors

These require significant cross-file or schema changes. Do not start until Wave 2 is merged and deployed.

---

### M5 — `group_predictions` 4-column shape prevents DB-level duplicate enforcement

**Plan:**

1. Create new migration: `drizzle/migrations/0012_group_prediction_picks.sql`
   ```sql
   CREATE TABLE IF NOT EXISTS group_prediction_picks (
     id            SERIAL PRIMARY KEY,
     prediction_id INTEGER NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
     group_name    TEXT NOT NULL,
     position      INTEGER NOT NULL CHECK (position BETWEEN 1 AND 4),
     team_id       INTEGER NOT NULL REFERENCES teams(id),
     UNIQUE (prediction_id, group_name, team_id),
     UNIQUE (prediction_id, group_name, position)
   );
   CREATE INDEX IF NOT EXISTS idx_gpp_pred ON group_prediction_picks (prediction_id);
   ```
2. Write a one-time data migration script to backfill `group_prediction_picks` from `group_predictions.position_1..4`.
3. Update `api/predictions/group/+server.ts` to write to the new table.
4. Update all `queries.ts` functions that read group predictions to use the new table.
5. Drop the old `group_predictions` table once all reads/writes are migrated.

---

### M6 — `tiebreaker` is a 1:1 sidecar join

**Plan:**

1. New migration: add `tiebreaker_home INTEGER, tiebreaker_away INTEGER` columns to `predictions`.
2. Data migration: copy existing `tiebreaker` rows into the new columns.
3. Update all read/write paths that join `tiebreaker` to use the inline columns.
4. Drop the `tiebreaker` table.

---

### M7 — `site_settings` one-row table for a single boolean

**Plan:**

Replace the DB key-value table with an environment variable `ALLOW_POOL_CREATION=all|admin`. Update `+page.server.ts` and any pool-creation guard to read `process.env.ALLOW_POOL_CREATION`. Remove the `site_settings` table in a migration once the env var is in all environments.

---

### M10 — `pool/[id]/+page.server.ts` 10 serial queries, redundant data

**Plan:**

1. Identify which of the ~10 queries are independent and parallelize with `Promise.all`.
2. Drop `userGroupPredsFull` and `userBracketPredsFull` — derive the extra column they carry from `groupPreds` and `bracketPreds` at the callsite.
3. Unify `teams` and `resultsTeamCache` into a single map passed down.

---

### M13 — `+layout.svelte` uses `document.querySelectorAll` with a 100 ms timeout

**Plan:**

Replace the `stagger()` + `setTimeout` pattern with Svelte 5 `in:fly` or `in:fade` transitions directly on the card components. Each card receives its stagger index as a prop: `in:fade={{ delay: index * 60 }}`. Remove the `$effect(() => { $page; setTimeout(stagger, 100); })` block entirely.

---

### M18 — `api/auth/[action]` multiplexes three distinct flows

**Plan:**

Create three separate route handlers:
- `src/routes/api/auth/login/+server.ts`
- `src/routes/api/auth/register/+server.ts`
- `src/routes/api/auth/logout/+server.ts`

Move the corresponding branches from `[action]/+server.ts` into each file. Update `publicPathPrefixes` in `hooks.server.ts` (already done in M19). Update all client-side `fetch('/api/auth/login', ...)` calls to use the new paths. Delete the `[action]` route directory.

---

### M20 — Inline styles throughout all Svelte files

**Plan:**

Pick a lane: Tailwind v4 utility classes. For each component, replace inline `style="..."` attributes with Tailwind utility classes. The `@import "tailwindcss"` already exists in `app.css` (though currently mis-ordered — see Wave 1 or after, fix by moving it to line 1 of `app.css`). Work component by component starting with the highest-traffic pages (`+layout.svelte`, `+page.svelte`).

---

### M21 — Light-mode dark `rgba(255,255,255,…)` values hardcoded in components

**Plan:**

Audit every `rgba(255,255,255,…)` and `#3d2a00`-style literal in Svelte component `style=` attributes. For each one, either:
- Replace with a CSS variable from the `:root[data-theme="light"]` block in `app.css`, or
- Move the style to a class in `app.css` that reacts to `[data-theme="light"]`.

This is incremental — work through `bracket/+page.svelte` (highest inline-style density) first.

---

### M24 — Tests split across two directories

**Plan:**

Move `src/tests/routes/*.test.ts` into `src/lib/server/` alongside their subjects, following the idiomatic co-location pattern. Update `vitest.config.ts` include globs. Delete the `src/tests/routes/` directory once empty. Document the convention in a `CONTRIBUTING.md` or the repo `README.md`.

---

## Dependency / apply order

```
Wave 1 (any order):
  M17 (errCode)        — create src/lib/server/err-code.ts first, then update callers
  M28 (constants)      — create src/lib/constants.ts first, then update callers
  M12, M22, M23        — pure CSS, independent
  C1, C3, H1, H7, H9  — isolated file fixes
  M14                  — isolated to +layout.svelte line 26

Wave 2 (order matters within this wave):
  H6   → scoring.ts exports first, then queries.ts imports
  M8   → move 0006 file, then simplify migrate.ts
  M1+M2+M3 → single migration 0009 (run before code that depends on constraints)
  M4   → migration 0010 (run after 0009)
  M26  → migration 0011 (run after 0010; required before live-scores query works)
  C2   → type fix (grep & update all callsites after)
  H8   → create src/lib/teams.ts, then update 3 pages
  H2+H10 → bracket server changes (hoist droppedPhases first, then phase-sort loop)
  H3   → sync rescoring in results + sync-scores
  H4   → hooks.server.ts origin check
  H5   → rate-limit.ts warning
  M9   → migrate.ts transaction fix
  M11  → cache.ts type + guard
  M15  → predict page selections merge
  M16  → request.json try/catch (each file independently)
  M19  → hooks.server.ts publicPaths (depends on M8 so /api/auth/... explicit list is clean)
  M25  → live-scores gate

Wave 3 (after Wave 2 merged and deployed):
  M5, M6, M7, M10, M13, M18, M20, M21, M24
```
