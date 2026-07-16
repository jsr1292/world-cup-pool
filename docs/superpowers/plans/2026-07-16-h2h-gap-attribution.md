# H2H Gap-Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the head-to-head comparison to answer "how did I lose to this person" — a signed point gap, a category breakdown that sums to it, and the top individual swings — with a "vs mí" entry point on each leaderboard row.

**Architecture:** A pure `computeAttribution` helper takes both entries' per-item `points_earned` and returns the ready-to-render structure (gap, category deltas, top swings). The h2h loader fetches per-item points read-only and calls it. The h2h page renders a new "por qué" block above a cleaned-up similarity section. The leaderboard gains a "vs mí" link per row.

**Tech Stack:** TypeScript, Svelte 5 (runes), SvelteKit, Vitest. The helper is pure and framework-free.

**Spec:** `docs/superpowers/specs/2026-07-16-h2h-gap-attribution-design.md`

## Global Constraints

- **PRODUCTION IS LIVE.** `.env`'s `DATABASE_URL` points at the live Neon prod DB with real frozen bets. Any prod access is **read-only SELECTs**. NEVER run `npm run migrate`, `npm run seed`, `npm run seed:matches`, or `npm run setup`.
- This feature requires **no schema change, no migration, no writes**. If a step seems to need one, stop.
- Do NOT modify `src/lib/server/scoring.ts` — `points_earned` is the source of truth and is read, never recomputed.
- The helper `src/lib/h2h-attribution.ts` stays **pure** — no imports from `$lib/server/*`, no I/O, no team lookups, no i18n. Labels arrive already localized.
- UI copy is **Spanish**, matching the existing views.
- All money/points come from stored `points_earned`; never hand-compute a pick's value from the rule table.

### Verification baselines (measured on `master` at `bc9d0fc`)

- `npm test`: **413 passing across 41 files**, fully green. Task 1 adds tests → the count rises; every task must keep the suite green.
- `npm run check`: **593 pre-existing errors** repo-wide. Do NOT try to fix them. The gate is **no NEW errors in the files you touch**.
  - `src/routes/pool/[id]/+page.svelte` already has **2 pre-existing errors**: `96:28` and `969:18` (`Parameter … implicitly has an 'any' type`). These are the baseline for that file — anything else there is yours.
  - `src/routes/pool/[id]/h2h/+page.server.ts`, `src/routes/pool/[id]/h2h/+page.svelte`, and the new `src/lib/h2h-attribution.ts` have **0** pre-existing errors.

  Check a touched file with:
  ```bash
  npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'h2h-attribution|h2h/\+page|pool/\[id\]/\+page\.svelte'
  ```
  For `+page.svelte`, expect ONLY the two baseline lines (96, 969). For the h2h files and the helper, expect none.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/h2h-attribution.ts` | Create | Pure gap-attribution: gap, category deltas, top swings. |
| `src/lib/h2h-attribution.test.ts` | Create | Unit tests for the helper. |
| `src/routes/pool/[id]/h2h/+page.server.ts` | Modify | Fetch per-item points for both entries, build `ItemPoints[]`, call helper, return `Attribution`. |
| `src/routes/pool/[id]/h2h/+page.svelte` | Modify | Render the "por qué" block; de-dup + restyle the similarity section. |
| `src/routes/pool/[id]/+page.svelte` | Modify | "vs mí" link per non-own leaderboard row. |

Not touched: `src/lib/server/scoring.ts`, the DB schema, the dropdown selectors, the summary view's "Comparar con las mías" link.

## Data facts (verified read-only against prod)

- Summed `points_earned` across the three prediction tables equals `predictions.total_score` for every entry — the breakdown reconciles exactly.
- **Resultados**: `match_predictions.points_earned` ∈ {0,1}, one row per group match.
- **Posición**: `group_predictions.points_earned` ∈ {0,2,4,8}, one row per group.
- **Eliminatorias**: `bracket_predictions.points_earned`, one row per `(phase, slot)`; `team_id` names the pick. The champion (`phase='final'`) row's `points_earned` already includes the winner bonus. Phase counts per entry: r32 24, r16 8, qf 4, sf 2, final 1, 3rd 1.
- The h2h loader already defaults `a` to the caller's own first entry (`+page.server.ts:37`), so a leaderboard row link needs only `?b={entryId}`.

## Phase labels (reuse the existing map)

`{ r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', final: 'Final', '3rd': '3er puesto' }` — matching `+page.svelte:419-427`. For the champion slot use **`Campeón`** rather than `Final`.

---

### Task 1: Pure attribution helper

**Files:**
- Create: `src/lib/h2h-attribution.ts`
- Test: `src/lib/h2h-attribution.test.ts`

**Interfaces:**
- Produces: `computeAttribution(items: ItemPoints[], opts?: { maxSwings?: number }): Attribution` and the exported types below. No consumers yet; Task 2 wires it.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/h2h-attribution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeAttribution, type ItemPoints } from './h2h-attribution.js';

const item = (key: string, category: any, you: number, them: number, label = key): ItemPoints =>
  ({ key, label, category, you, them });

describe('computeAttribution', () => {
  it('signs the gap as you − them (behind, ahead, level)', () => {
    // yourTotal = 0+1+6+1 = 8; theirTotal = 8+4+0+0 = 12; gap = -4 (behind).
    const behind = computeAttribution([
      item('pos:F', 'posicion', 0, 8), item('pos:B', 'posicion', 1, 4),
      item('ko:r16:0', 'eliminatorias', 6, 0), item('res:1', 'resultados', 1, 0),
    ]);
    expect(behind.yourTotal).toBe(8);
    expect(behind.theirTotal).toBe(12);
    expect(behind.gap).toBe(-4);

    const ahead = computeAttribution([item('a', 'resultados', 5, 2)]);
    expect(ahead.gap).toBe(3);

    const level = computeAttribution([item('a', 'resultados', 4, 4)]);
    expect(level.gap).toBe(0);
  });

  it('category deltas sum to the gap and are in fixed order', () => {
    const a = computeAttribution([
      item('pos:F', 'posicion', 0, 8),
      item('ko:final:0', 'eliminatorias', 14, 0),
      item('res:1', 'resultados', 1, 0),
      item('res:2', 'resultados', 0, 1),
    ]);
    expect(a.categories.map((c) => c.category)).toEqual(['posicion', 'eliminatorias', 'resultados']);
    expect(a.categories.reduce((s, c) => s + c.delta, 0)).toBe(a.gap);
    expect(a.categories.find((c) => c.category === 'posicion')!.delta).toBe(-8);
    expect(a.categories.find((c) => c.category === 'eliminatorias')!.delta).toBe(14);
    expect(a.categories.find((c) => c.category === 'resultados')!.delta).toBe(0);
  });

  it('orders swings by |delta| desc; a group-position swing outranks a smaller champion delta', () => {
    const a = computeAttribution([
      item('pos:F', 'posicion', 0, 8, 'Grupo F · posición'),   // delta -8
      item('ko:final:0', 'eliminatorias', 6, 0, 'Campeón'),    // delta +6
      item('pos:B', 'posicion', 4, 1, 'Grupo B · posición'),   // delta +3
      item('res:1', 'resultados', 1, 1),                       // delta 0 → excluded
    ]);
    expect(a.swings.map((s) => s.key)).toEqual(['pos:F', 'ko:final:0', 'pos:B']);
    expect(a.swings.every((s) => s.delta !== 0)).toBe(true);
  });

  it('caps swings and breaks ties deterministically', () => {
    const items = [
      item('res:3', 'resultados', 1, 0), item('res:1', 'resultados', 1, 0),
      item('res:2', 'resultados', 1, 0), item('res:5', 'resultados', 1, 0),
      item('res:4', 'resultados', 1, 0), item('res:6', 'resultados', 1, 0),
    ];
    const a = computeAttribution(items, { maxSwings: 3 });
    expect(a.swings).toHaveLength(3);
    // all |delta|=1, same category → tiebreak by key asc, stable across runs
    expect(a.swings.map((s) => s.key)).toEqual(['res:1', 'res:2', 'res:3']);
    expect(computeAttribution(items, { maxSwings: 3 }).swings.map((s) => s.key)).toEqual(['res:1', 'res:2', 'res:3']);
  });

  it('identical sides → gap 0, no swings, zero category deltas', () => {
    const a = computeAttribution([
      item('pos:A', 'posicion', 4, 4), item('ko:r16:0', 'eliminatorias', 3, 3),
    ]);
    expect(a.gap).toBe(0);
    expect(a.swings).toEqual([]);
    expect(a.categories.every((c) => c.delta === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/h2h-attribution.test.ts`
Expected: FAIL — `computeAttribution` is not defined / module missing.

- [ ] **Step 3: Implement the helper**

Create `src/lib/h2h-attribution.ts`:

```ts
// Pure gap attribution for the head-to-head view. Given both entries' points on
// every scorable item (already localized labels), it returns the signed gap
// (you − them), the per-category deltas that sum to it, and the individual picks
// that swung it most. No I/O, no team lookups, no i18n — trivially testable.

export type H2hCategory = 'posicion' | 'eliminatorias' | 'resultados';

export interface ItemPoints {
  /** Stable id, e.g. "pos:F", "ko:r16:0", "res:123". */
  key: string;
  /** Display label, already localized by the caller. */
  label: string;
  category: H2hCategory;
  you: number;
  them: number;
}

export interface Swing {
  key: string; label: string; category: H2hCategory;
  delta: number; you: number; them: number;
}
export interface CategoryDelta { category: H2hCategory; you: number; them: number; delta: number }

export interface Attribution {
  gap: number;          // yourTotal − theirTotal
  yourTotal: number;
  theirTotal: number;
  categories: CategoryDelta[];  // always in CATEGORY_ORDER
  swings: Swing[];              // |delta| desc, delta != 0, capped
}

// Display order: positions first (the biggest category in this pool's scoring),
// then knockout, then group results.
const CATEGORY_ORDER: H2hCategory[] = ['posicion', 'eliminatorias', 'resultados'];

export function computeAttribution(items: ItemPoints[], opts?: { maxSwings?: number }): Attribution {
  const maxSwings = opts?.maxSwings ?? 5;

  let yourTotal = 0, theirTotal = 0;
  const byCat = new Map<H2hCategory, { you: number; them: number }>();
  for (const c of CATEGORY_ORDER) byCat.set(c, { you: 0, them: 0 });

  for (const it of items) {
    yourTotal += it.you;
    theirTotal += it.them;
    const acc = byCat.get(it.category)!;
    acc.you += it.you;
    acc.them += it.them;
  }

  const categories: CategoryDelta[] = CATEGORY_ORDER.map((category) => {
    const { you, them } = byCat.get(category)!;
    return { category, you, them, delta: you - them };
  });

  const swings: Swing[] = items
    .map((it) => ({ key: it.key, label: it.label, category: it.category, delta: it.you - it.them, you: it.you, them: it.them }))
    .filter((s) => s.delta !== 0)
    .sort((a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.key.localeCompare(b.key))
    .slice(0, maxSwings);

  return { gap: yourTotal - theirTotal, yourTotal, theirTotal, categories, swings };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/h2h-attribution.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test`
Expected: **418 passing** (413 + 5).

Then: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'h2h-attribution'`
Expected: **empty**.

- [ ] **Step 6: Commit**

```bash
git add src/lib/h2h-attribution.ts src/lib/h2h-attribution.test.ts
git commit -m "feat(h2h): pure gap-attribution helper

Signed gap (you - them), per-category deltas that sum to it, and the
top individual swings. Pure and framework-free."
```

---

### Task 2: Server — build per-item points and attribution

**Files:**
- Modify: `src/routes/pool/[id]/h2h/+page.server.ts`

**Interfaces:**
- Consumes: `computeAttribution`, `ItemPoints`, `H2hCategory` from `$lib/h2h-attribution.js`.
- Produces: the loader's returned object gains `attribution: Attribution | null` (null unless both `a` and `b` are chosen). Existing return fields are unchanged.

- [ ] **Step 1: Add a per-item points fetch**

In `src/routes/pool/[id]/h2h/+page.server.ts`, add a helper alongside `sideFor` that returns raw per-item points for one entry:

```ts
async function itemPointsFor(pid: number) {
  const matchPts: Record<number, number> = {};
  for (const r of (await query(
    `SELECT mp.match_id AS mid, mp.points_earned AS pts
     FROM match_predictions mp JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
     WHERE mp.prediction_id = $1`, [pid]
  )).rows) matchPts[Number(r.mid)] = Number(r.pts) || 0;

  const groupPts: Record<string, number> = {};
  for (const r of (await query(
    `SELECT group_name AS g, points_earned AS pts FROM group_predictions WHERE prediction_id = $1`, [pid]
  )).rows) groupPts[r.g] = Number(r.pts) || 0;

  // Knockout keyed by "phase:slot", carrying the picked team for labels.
  const bracket: Record<string, { teamId: number | null; pts: number }> = {};
  for (const r of (await query(
    `SELECT phase, slot, team_id, points_earned AS pts FROM bracket_predictions WHERE prediction_id = $1`, [pid]
  )).rows) bracket[`${r.phase}:${r.slot}`] = { teamId: r.team_id, pts: Number(r.pts) || 0 };

  return { matchPts, groupPts, bracket };
}
```

- [ ] **Step 2: Build `ItemPoints[]` and call the helper in `load`**

In `load`, after `const b = bId ? await sideFor(bId, entries) : null;` and after `groupMatches` is fetched, add:

```ts
  let attribution = null;
  if (aId && bId) {
    const ai = await itemPointsFor(aId);
    const bi = await itemPointsFor(bId);
    const tName = (id: number | null) => (id != null && teams[id]?.name ? shortName(teams[id].name) : '—');
    const PHASE_LABEL: Record<string, string> = {
      r32: 'Dieciseisavos', r16: 'Octavos', qf: 'Cuartos', sf: 'Semifinales', final: 'Campeón', '3rd': '3er puesto',
    };
    const items: ItemPoints[] = [];

    // Resultados — one item per group fixture (chronological list already loaded).
    for (const m of groupMatches) {
      const you = ai.matchPts[m.id] ?? 0, them = bi.matchPts[m.id] ?? 0;
      items.push({
        key: `res:${m.id}`, category: 'resultados',
        label: `${tName(m.home_team_id)}–${tName(m.away_team_id)}`,
        you, them,
      });
    }
    // Posición — one item per group A..L (union of both sides' group rows).
    for (const g of new Set([...Object.keys(ai.groupPts), ...Object.keys(bi.groupPts)])) {
      items.push({
        key: `pos:${g}`, category: 'posicion', label: `Grupo ${g} · posición`,
        you: ai.groupPts[g] ?? 0, them: bi.groupPts[g] ?? 0,
      });
    }
    // Eliminatorias — one item per (phase, slot); label by whichever side scored.
    for (const k of new Set([...Object.keys(ai.bracket), ...Object.keys(bi.bracket)])) {
      const you = ai.bracket[k]?.pts ?? 0, them = bi.bracket[k]?.pts ?? 0;
      const phase = k.split(':')[0];
      const scorerTeam = you >= them ? ai.bracket[k]?.teamId : bi.bracket[k]?.teamId;
      items.push({
        key: `ko:${k}`, category: 'eliminatorias',
        label: `${PHASE_LABEL[phase] ?? phase} · ${tName(scorerTeam ?? null)}`,
        you, them,
      });
    }
    attribution = computeAttribution(items);
  }
```

Add the imports at the top of the file:

```ts
import { computeAttribution, type ItemPoints } from '$lib/h2h-attribution.js';
import { shortName } from '$lib/teams.js';
```

Return `attribution` from `load` — add it to the final `return { ... }` object (both the `betsLocked: true` return and, as `attribution: null`, the early `!betsLocked` return so the type is stable).

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'h2h/\+page\.server'`
Expected: **empty**.

- [ ] **Step 4: Read-only reconcile probe**

Write a scratch probe (in your session's scratchpad dir) — **READ-ONLY, SELECTs only** — importing the loader path is awkward, so replicate the two entries' `total_score` and confirm the helper's `gap` matches. Minimal version:

```ts
import '/Users/jsr/world-cup-pool/src/lib/server/load-env.js';
import { query, getPool } from '/Users/jsr/world-cup-pool/src/lib/server/db.js';
const { rows } = await query(`SELECT p.id, p.total_score FROM predictions p WHERE p.pool_id = 1 ORDER BY p.total_score DESC LIMIT 2`);
const [a, b] = rows;
console.log(`a.total=${a.total_score} b.total=${b.total_score} expected gap(a−b)=${a.total_score - b.total_score}`);
// The loader's attribution.gap for a-vs-b must equal a.total_score - b.total_score.
await getPool().end();
```

Run: `npx tsx <that file>`. Note the expected gap. The real reconcile is confirmed in Task 6 by driving the loader; this step just records the target.

- [ ] **Step 5: Commit**

```bash
git add src/routes/pool/\[id\]/h2h/+page.server.ts
git commit -m "feat(h2h): compute gap attribution in the loader

Fetch both entries' per-item points_earned (group matches, group
positions, bracket slots), build localized items, and return the
attribution alongside the existing side-by-side data. Read-only."
```

---

### Task 3: The "por qué" block

**Files:**
- Modify: `src/routes/pool/[id]/h2h/+page.svelte`

**Interfaces:**
- Consumes: `data.attribution` (`Attribution | null`) from Task 2.

No unit test (no Svelte component harness). Verified by Task 6.

- [ ] **Step 1: Render the block above the existing summary card**

In `src/routes/pool/[id]/h2h/+page.svelte`, inside the `{#if !data.a || !data.b}{:else}` branch, BEFORE the existing `{#if agreement}` card, add the why-block. Use `data.a.owner` / `data.b.owner` for names and `data.attribution`:

```svelte
{#if data.attribution}
  {@const at = data.attribution}
  {@const rival = data.b.owner.split(' ')[0]}
  {@const maxCat = Math.max(1, ...at.categories.map((c) => Math.abs(c.delta)))}
  <section style="margin-bottom: 18px; padding: 14px; background: rgba(201,168,76,0.06); border: 1px solid rgba(201,168,76,0.25); border-radius: 12px;">
    <div style="text-align: center; font-size: 16px; font-weight: 800; color: {at.gap < 0 ? 'var(--red)' : at.gap > 0 ? 'var(--green)' : 'var(--gold)'};">
      {#if at.gap < 0}Vas por detrás de {rival} por {Math.abs(at.gap)} pts
      {:else if at.gap > 0}Le sacas {at.gap} pts a {rival}
      {:else}Empatados con {rival}{/if}
    </div>
    <div style="text-align: center; font-size: 11px; color: var(--text-muted); margin-top: 2px;">
      Tú {at.yourTotal} · {rival} {at.theirTotal}
    </div>

    <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); margin: 14px 0 6px;">DÓNDE SE DECIDIÓ</div>
    {#each at.categories as c}
      {@const w = (Math.abs(c.delta) / maxCat) * 50}
      <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 3px 0;">
        <span style="flex: 1; color: var(--text);">{catLabel(c.category)}</span>
        <span style="width: 110px; display: flex; align-items: center; flex-shrink: 0;">
          <span style="width: 50%; display: flex; justify-content: flex-end;">
            {#if c.delta < 0}<span style="height: 8px; width: {w}%; background: var(--red); border-radius: 2px;"></span>{/if}
          </span>
          <span style="width: 1px; height: 12px; background: var(--border);"></span>
          <span style="width: 50%;">
            {#if c.delta > 0}<span style="height: 8px; width: {w}%; background: var(--green); border-radius: 2px; display: block;"></span>{/if}
          </span>
        </span>
        <span style="width: 34px; text-align: right; flex-shrink: 0; font-weight: 700; color: {c.delta < 0 ? 'var(--red)' : c.delta > 0 ? 'var(--green)' : 'var(--text-dim)'};">{c.delta > 0 ? '+' : ''}{c.delta}</span>
      </div>
    {/each}
    <div style="display: flex; font-size: 12px; padding: 6px 0 0; margin-top: 4px; border-top: 1px solid var(--border); font-weight: 800;">
      <span style="flex: 1; color: var(--text-muted);">Total</span>
      <span style="width: 34px; text-align: right; color: {at.gap < 0 ? 'var(--red)' : at.gap > 0 ? 'var(--green)' : 'var(--text-dim)'};">{at.gap > 0 ? '+' : ''}{at.gap}</span>
    </div>

    {#if at.swings.length > 0}
      <div style="font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: var(--text-muted); margin: 14px 0 6px;">LO QUE MÁS PESÓ</div>
      {#each at.swings as s}
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.04);">
          <span style="width: 34px; flex-shrink: 0; font-weight: 800; color: {s.delta < 0 ? 'var(--red)' : 'var(--green)'};">{s.delta > 0 ? '+' : ''}{s.delta}</span>
          <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text);">{s.label}</span>
          <span style="flex-shrink: 0; font-size: 10px; color: var(--text-dim);">tú {s.you} · {rival} {s.them}</span>
        </div>
      {/each}
    {/if}
  </section>
{/if}
```

- [ ] **Step 2: Add the category-label helper to the `<script>`**

```ts
  function catLabel(c: string): string {
    return c === 'posicion' ? 'Posición (tabla)' : c === 'eliminatorias' ? 'Eliminatorias' : 'Resultados 1/X/2';
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'h2h/\+page\.svelte'`
Expected: **empty**.

- [ ] **Step 4: Commit**

```bash
git add src/routes/pool/\[id\]/h2h/+page.svelte
git commit -m "feat(h2h): render the gap-attribution 'por qué' block

Signed headline gap, category deltas as diverging bars that sum to the
gap, and the top swings — above the existing similarity card."
```

---

### Task 4: De-dup and restyle the similarity section

**Files:**
- Modify: `src/routes/pool/[id]/h2h/+page.svelte`

- [ ] **Step 1: Trim the now-duplicated lines from the summary card**

In the existing `{#if agreement}` card, REMOVE the two blocks that the why-block now owns:
- the "✓ aciertos: … {aOk} · … {bOk}" line (`groupCorrect`), and
- the "🏅 … pts (resultados · +posición · +elim.)" score-split block (`data.a.totalScore …`).

Keep the coincidences line and the "⚽ coinciden en …" group-agreement line. The related `$derived` `groupCorrect` may be left in place (harmless) or removed if unused after this edit — remove it only if nothing else references it.

- [ ] **Step 2: Add correct/wrong marking to the single-pick `row` snippet** *(optional within this task — the de-dup and legibility below are the core; defer this with DONE_WITH_CONCERNS if it widens scope)*

The `row` snippet (Campeón + group winners) currently shows only `=`/`≠`. Give each side's pick a ✓/✗ when the actual result is known. Extend the snippet signature to accept the winning team id and mark each side:

Change the snippet definition from `{#snippet row(label, av, bv)}` to also take the actual winner, and render a small ✓ (green) when a side's pick equals it, ✗ (red) when not, nothing when unknown. For the champion row pass the actual tournament champion if decided; for each group winner pass that group's actual 1st-place team. Derive these from data already available (the teams/standings the page has), or — if not readily available client-side — add the actual champion and actual group winners to the loader return in Task 2's return object and read them here. Keep it minimal: if the actual result is not resolvable, render no ✓/✗ (unchanged behaviour), never a guess.

> Implementer note: prefer deriving "actual group winner" and "actual champion" on the SERVER (the loader already queries matches/standings elsewhere in the app) and returning them as `actualGroupWinners: Record<string, number>` and `actualChampion: number | null`, both read-only. If that widens the task too far, mark it DONE_WITH_CONCERNS and flag that the ✓/✗ on single-pick rows was deferred — the de-dup and font legibility (Step 3) are the core of this task.

- [ ] **Step 3: Bump font legibility**

In the similarity section only (the `row` snippet, the `matchRow` snippet, the finalists/tiebreaker panels, and the section headings), raise the smallest fonts from 8–11px to 12–13px, keeping hierarchy (labels can stay one step smaller than values). Do not touch the why-block from Task 3. Keep it tasteful; this is a legibility pass, not a redesign.

- [ ] **Step 4: Typecheck + full suite**

Run: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'h2h/\+page\.svelte'` → expect empty.
Run: `npm test` → expect **418 passing**, unchanged (no new tests here).

- [ ] **Step 5: Commit**

```bash
git add src/routes/pool/\[id\]/h2h/+page.svelte
git commit -m "feat(h2h): quieter, legible similarity section

Drop the score-split and aciertos lines now owned by the por-qué block,
add correct/wrong marks to the champion + group-winner rows, and bump
the cramped 8-11px fonts to a readable size."
```

---

### Task 5: "vs mí" leaderboard entry point

**Files:**
- Modify: `src/routes/pool/[id]/+page.svelte`

- [ ] **Step 1: Wrap the row and add a sibling compare link**

The leaderboard row (`+page.svelte:714-738`) is a single `<a>` when `betsLocked`. A nested `<a>` is invalid HTML, so wrap the row element and the new link as SIBLINGS in a positioned container.

Replace the row's opening — currently:

```svelte
{#each data.leaderboard as entry, i}
  {@const mine = entry.user_id === data.userId}
  {@const rank = leaderboardRanks[i]}
  <svelte:element this={betsLocked ? 'a' : 'div'} href={betsLocked ? `/pool/${pool.id}/summary?view=${entry.id}` : undefined} id={mine ? 'my-row' : ''} class="leaderboard-row" ...>
```

Wrap it:

```svelte
{#each data.leaderboard as entry, i}
  {@const mine = entry.user_id === data.userId}
  {@const rank = leaderboardRanks[i]}
  <div class="lb-row-wrap">
    <svelte:element this={betsLocked ? 'a' : 'div'} href={betsLocked ? `/pool/${pool.id}/summary?view=${entry.id}` : undefined} id={mine ? 'my-row' : ''} class="leaderboard-row" ...>
      ...unchanged row content...
    </svelte:element>
    {#if betsLocked && !mine}
      <a class="vs-me" href="/pool/{pool.id}/h2h?b={entry.id}" aria-label="Comparar conmigo" onclick={(e) => e.stopPropagation()}><Icon name="swords" size={11} /> vs mí</a>
    {/if}
  </div>
{/each}
```

The loader defaults side `a` to the caller's own entry, so `?b={entry.id}` is sufficient — no need to compute the caller's entry id here.

- [ ] **Step 2: Style the wrapper and the link**

Add to the component's `<style>`:

```css
  .lb-row-wrap { position: relative; }
  .vs-me {
    position: absolute; top: 6px; right: 8px; z-index: 2;
    display: inline-flex; align-items: center; gap: 3px;
    font-size: 9px; color: var(--text-muted);
    background: var(--bg-surface); border: 1px solid var(--border);
    border-radius: 5px; padding: 2px 6px; text-decoration: none;
  }
  .vs-me:hover { color: var(--gold); border-color: rgba(201,168,76,0.4); }
```

The existing `.lb-chevron` sits at the row's right edge; place `.vs-me` at the top-right so it clears the vertically-centered chevron. If they visually collide, nudge in Step 4 — the structural requirement is only that `.vs-me` is a sibling of the row anchor (never a child) and sits above it (`z-index`).

- [ ] **Step 3: Typecheck**

Run: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'pool/\[id\]/\+page\.svelte'`
Expected: ONLY the two pre-existing baseline lines `96:28` and `969:18`. No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/pool/\[id\]/+page.svelte
git commit -m "feat(pool): 'vs mí' compare link on each leaderboard row

One tap from where you see you lost to the gap breakdown. Rendered as a
sibling of the row anchor (never nested) so the HTML stays valid."
```

---

### Task 6: Verification

**Files:** none modified.

- [ ] **Step 1: Full suite + full typecheck baseline**

Run: `npm test` → expect **418 passing across 41 files**.
Run: `npm run check 2>&1 | grep -cE '^[0-9]+ ERROR'` → expect **593 or fewer** (unchanged baseline; do not fix pre-existing).

- [ ] **Step 2: Read-only prod reconcile via the real loader**

Write a READ-ONLY probe that imports the h2h `load` and asserts `attribution.gap === a.total_score − b.total_score` for a real matchup in pool 1. If importing `load` is impractical (SvelteKit types), instead replicate the loader's item-building against the DB and call `computeAttribution`, then compare to the two entries' `total_score` difference. SELECTs only; never write.

Expected: the helper's `gap` equals the two entries' `total_score` difference exactly, and each category delta equals the difference of that category's summed `points_earned`.

- [ ] **Step 3: Drive the UI**

Use the `verify` skill or `npm run dev`. The pool page is auth-gated (`/pool/1` → `/login`) and points at prod, so do NOT manufacture a session. If a non-prod/local login is available, open pool 1's Clasificación, tap "vs mí" on another player's row, and confirm: the "por qué" block leads with the signed gap, the category bars diverge correctly (positions dominant), the total reconciles, and the swings are biggest-first. Otherwise record that the render is verified by typecheck + review only and needs a human eyeball — the same auth constraint as prior work.

- [ ] **Step 4: Commit any fixes**

Only if steps surfaced problems.
