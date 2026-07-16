# Head-to-head comparison — "por qué perdí" gap attribution

**Date:** 2026-07-16
**Status:** Approved, ready for implementation planning

## Problem

The head-to-head view (`/pool/[id]/h2h`, "⚔️ Comparar") is built around
*similarity*, not *loss*. It leads with "coincidencias" counts and `=`/`≠`
agreement markers, which answer "how alike are our picks" — a different question
from "how did I lose to this person." The one thing that explains a loss, the
point gap and where it came from, is crammed into a single 10px line showing two
parallel totals (`Juan 150 pts (…) · Ana 145 pts (…)`), leaving the reader to
subtract in their head.

Worse, the high-value picks are shown with no points attached. The champion,
finalists, and group-winner rows render as raw picks with `=`/`≠` only. And the
biggest scoring category of all is invisible as a scoring category: group table
positions.

### Verified data (read-only prod probe, pool 1)

- Summed `points_earned` across the three prediction tables equals the
  authoritative `predictions.total_score` for every entry. The breakdown
  reconciles exactly.
- Per-entry category split (top entry): **positions 72, knockout 60, results
  44.** Group table positions are the *largest* category — larger than the whole
  knockout bracket — yet the current view shows them only as raw "1.º A" pick
  rows with no points.
- Point structure per item:
  - **Resultados** (group 1/X/2): each `match_predictions` row earns 0 or 1
    (`match_outcome`). No exact-score / goal-difference bonus is applied in this
    pool — the distribution is strictly {0,1}.
  - **Posición** (group table order): each `group_predictions` row (one per
    group) earns 0/2/4/8 (`group_position` = 2 per correct slot, up to 4).
  - **Eliminatorias** (knockout): each `bracket_predictions` row earns its
    phase's points — R32 ×2, R16 ×3, QF ×4, SF ×6, champion 8+6, 3rd 6.

The consequence for design: **group positions must be first-class**, not buried.
A single group where you nailed the order and your rival didn't is an 8-point
swing, larger than getting the champion right.

## Goal

Reframe the comparison so it answers "how did I lose to this person" directly:
lead with the point gap and exactly which picks caused it, then keep a
cleaned-up similarity section below for people who want the pick-by-pick overlap.

## Scope

In scope:

- A "por qué" (why) block at the top: signed gap, category breakdown that sums
  to the gap, and the top individual swings.
- A cleaned-up similarity section below it (the existing content, de-duplicated
  and made legible).
- A "vs mí" entry point on each other player's leaderboard row.
- A pure, unit-tested attribution helper.

Out of scope:

- No schema change, no migration, no writes. Read-only additions to the h2h
  loader.
- No change to how scoring computes `points_earned` (`src/lib/server/scoring.ts`
  is the source of truth and is untouched).
- The dropdown selectors and the "Comparar con las mías" link from the summary
  view stay as they are.

## Key decisions

### Directional, from the viewer's perspective

Side `a` defaults to the caller's own entry (already the loader's behaviour).
Everything in the why-block is computed as **`you − them`**: negative means you
are behind on that item (rendered red), positive means ahead (green). One sign
convention across the headline gap, the category deltas, and the swings, so
nothing needs re-reading.

If the caller holds multiple entries, `a` defaults to their first entry, matching
the loader's current default.

### Categories sum to the gap, exactly

The gap is decomposed into three categories — **Posición, Eliminatorias,
Resultados** — each a signed `you − them` delta. Their sum equals the total gap
by construction, because it is computed from the same per-item `points_earned`
the totals are summed from. A visible total row proves the reconciliation.

The gap the block displays is `sum(you − them)` over every scorable item, which
equals `yourTotal − theirTotal`. Because both totals come from summed
`points_earned` (verified equal to `total_score`), the block's headline gap
matches the leaderboard gap. If scoring were stale, both this view and the
leaderboard would be stale identically — there is no independent computation to
drift.

### "Lo que más pesó" — the top swings

The individual items with the largest absolute `you − them` delta, biggest first,
capped at 5. Each line shows the item, the signed delta, and both sides' points
(e.g. `−8  Grupo F · posición   Rival 8 · tú 0`). Group-position rows (a single
0/2/4/8 unit) can legitimately outrank a champion pick here — that is the point.
Items where both sides earned the same points contribute 0 and never appear.

### Category bar: diverging center line

Each category row draws a bar diverging from a vertical center line — ahead grows
right (green), behind grows left (red), width = magnitude. Net direction is
readable at a glance before any number is parsed.

## Design

### Why-block layout

```
┌────────────────────────────────────────────┐
│   Vas por detrás de Rival por  −5 pts        │   signed headline gap
│         Tú 88   ·   Rival 93                 │
│                                              │
│   DÓNDE SE DECIDIÓ                           │
│   Posición (tabla)   ▓▓▓▓▓▓│         −6      │   diverging bars,
│   Eliminatorias            │                0│   green right / red left,
│   Resultados 1/X/2         │▓        +1      │   width = |delta|
│   ──────────────────────────────────────    │
│   Total                              −5      │   reconciles to the gap
│                                              │
│   LO QUE MÁS PESÓ                            │
│   −8  Grupo F · posición    Rival 8 · tú 0  │   top swings, |Δ| desc, ≤5
│   +6  Octavos · España      tú 6 · Rival 0  │
│   −3  Grupo B · posición    Rival 4 · tú 1  │
└────────────────────────────────────────────┘
```

Headline copy by sign of the gap (`g = yourTotal − theirTotal`):
- `g < 0` → "Vas por detrás de {Rival} por {|g|} pts"
- `g > 0` → "Le sacas {g} pts a {Rival}"
- `g === 0` → "Empatados con {Rival}"

### Similarity section ("En qué coincidís")

Below the why-block, under its own heading, visually quieter. Reuses the existing
markup with two changes:

- **De-duplicated.** The old agreement card's score-split line and
  "who got more correct" line move into the why-block and are removed here. What
  remains is one compact line: coincidences (champion + group winners), shared
  finalists, group-game agreement.
- **Legible.** Fonts bump from 8–11px to 12–13px with clearer hierarchy.
- **Correct/wrong on the single-pick rows.** Campeón and the group-winner rows
  (`1.º A`–`1.º L`) currently show only `=`/`≠`. Each side's pick gains the same
  green-✓ / red-✗ marking the group-match grid already uses, since results now
  exist. This stays "what each of you picked" — the why-block owns "what it
  cost."

The chronological group-match 1/X/2 grid and the finalists + tiebreaker panels
carry over, restyled for legibility.

### Entry point — "vs mí" on leaderboard rows

`src/routes/pool/[id]/+page.svelte`: a small compare action on every entry row
that is **not** one of the caller's own, shown only when `betsLocked`. It links
to `/pool/{id}/h2h?a={myEntryId}&b={rowEntryId}`, landing directly on the
you-vs-them breakdown. `myEntryId` is the caller's own entry — their first, if
they hold several in the pool (matching the loader's default for `a`); the
dropdowns let them switch to another of their entries. Rows belonging to the
caller (any of their entries) show no button. The existing top-level "Comparar"
button and the dropdowns are unchanged.

### Attribution helper — `src/lib/h2h-attribution.ts`

Pure, framework-free, deterministic. This is the testable core.

```ts
export interface ItemPoints {
  key: string;      // stable id, e.g. "grp-pos:F", "ko:octavos:123", "match:456"
  label: string;    // display label, already localized by the caller
  category: 'resultados' | 'posicion' | 'eliminatorias';
  you: number;      // points_earned for side a on this item
  them: number;     // points_earned for side b on this item
}

export interface Swing { key: string; label: string; delta: number; you: number; them: number }
export interface CategoryDelta { category: string; you: number; them: number; delta: number }

export interface Attribution {
  gap: number;                    // yourTotal − theirTotal
  yourTotal: number;
  theirTotal: number;
  categories: CategoryDelta[];    // fixed order: posicion, eliminatorias, resultados
  swings: Swing[];                // |delta| desc, delta != 0, capped
}

export function computeAttribution(items: ItemPoints[], opts?: { maxSwings?: number }): Attribution;
```

- `gap = Σ(item.you − item.them)`; category deltas are the same sum partitioned
  by `category`; `Σ category.delta === gap` by construction.
- `swings` = items with `delta !== 0`, sorted by `|delta|` desc then a stable
  tiebreak (category order, then key) so output is deterministic; sliced to
  `maxSwings` (default 5).
- Labels are passed in already localized — the helper does no i18n and no team
  lookups, keeping it pure and trivially testable.

### Server changes — `src/routes/pool/[id]/h2h/+page.server.ts`

`sideFor` (or a sibling query) additionally returns per-item points for both
entries:

- **Resultados:** `match_predictions.points_earned` keyed by `match_id` (group
  phase).
- **Posición:** `group_predictions.points_earned` keyed by `group_name`.
- **Eliminatorias:** `bracket_predictions.points_earned` keyed by `(phase, slot)`
  with `team_id` for the label.

The loader builds the `ItemPoints[]` (localizing labels via the teams map and
phase names) and calls `computeAttribution`, returning the `Attribution` to the
page alongside the existing similarity data. All read-only.

## Testing

`src/lib/h2h-attribution.test.ts` (vitest, pure):

1. **Gap sign** — behind (`gap < 0`), ahead (`gap > 0`), level (`gap === 0`);
   headline-driving value correct in each.
2. **Categories sum to the gap** — for a mixed input, `Σ category.delta === gap`
   and each category delta equals the partitioned sum.
3. **Top-swings ordering** — sorted by `|delta|` desc; a single group-position
   swing (±8) outranks a smaller-delta champion item; equal items excluded
   (`delta === 0` never appears).
4. **Cap and determinism** — more than `maxSwings` differing items → exactly
   `maxSwings` returned, and ties broken deterministically (stable order across
   runs).
5. **Empty / identical** — two entries with identical points → `gap === 0`, no
   swings, all category deltas 0.

No component-test harness exists in this repo (`vitest.config.ts` includes only
`src/**/*.test.ts`; no `@testing-library/svelte`), so the Svelte view is verified
by running the app, not a unit test.

Verification: `npm test` (full suite), the typecheck gate (no new errors in
touched files against the pre-existing baseline), and a read-only prod probe that
the attribution for a real matchup reconciles — the helper's `gap` equals the two
entries' `total_score` difference.
