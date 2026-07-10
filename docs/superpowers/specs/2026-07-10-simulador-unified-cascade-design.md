# Simulador: unified group→knockout cascade

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan
**Area:** `src/lib/Simulator.svelte`, `src/lib/knockout-odds.ts`, `src/lib/sim-bracket.ts`, `src/lib/server/simulator-data.ts`

## Goal

Port the porra-mundial `/simulador` experience into world-cup-pool's Simulador so
that group and knockout what-ifs live in **one progressive-reveal view** with the
projected leaderboard beside it. The user picks any pending result — a group
`1/X/2` or a knockout winner — and every downstream round and the standings
re-derive live.

This is not a from-scratch build: world-cup-pool already has an interactive KO
what-if ("Cuadro interactivo") and a group `1/X/2` what-if ("Clasificación
proyectada"). They are two separate tabs backed by two disconnected engines. This
work **fuses them** into porra's single-list model, reusing world-cup-pool's own
bracket/scoring primitives (no second bracket definition imported from porra).

### What we are copying from porra-mundial (confirmed with user)

1. **Two-column layout** — pending picks on the left, projected leaderboard on the right.
2. **Progressive reveal** — show only pending ties; reveal each next round as its feeders resolve.
3. **Merge group + KO** — one combined "Pendientes" list (group `1/X/2` and knockout), not separate tabs.
4. **The extras** — points/rank deltas vs. live, a "Solo cambios" filter, a mobile impact bar, and "Pronóstico de {member}" (load a member's full forecast).

### Explicitly out of scope

- **Prize money / € deltas.** world-cup-pool has no pot/payout/prize concept in its
  schema; it is purely points-based. Porra's `eur` deltas have no equivalent and are
  dropped. (Adding a money model would be a separate feature.)
- The **🔮 Probabilidades** (Monte-Carlo win/podium odds) tab is unchanged and stays
  as its own separate tab.
- No bracket-tree diagram (neither app has one; both use ordered lists).

## Current state (what exists today)

- `src/lib/bracket-2026.ts` — FIFA 2026 knockout tree, single source of truth
  (`R32_MAP`, `THIRD_GROUP_MAP`, `R32_OFFICIAL_MATCH`). CI test asserts fidelity.
- `src/lib/sim-bracket.ts` — `rankThirds`, `assignThirds`, `buildR32`. Builds the 16
  R32 matchups (`{a, b}` with `SlotTeam{teamId,label,third}`) from resolved group
  placements. **Display-only today** — produces matchups, not winners.
- `src/lib/knockout-odds.ts` — pure KO engine. `resolveTree(byPhase, choose)`
  cascades R16→Final, but **seeds R16 only from _finished_ R32 winners**
  (`const r32w = byPhase.r32.map(finishedWinner)`, line ~118). `scoreEntry` mirrors
  `server/scoring.ts calculateBracketScores`. `computeKnockoutOdds` enumerates
  futures for the odds tab.
- `src/lib/Simulator.svelte` — one component, three sub-views today:
  - group `1/X/2` what-if (`sim` rune → `projection`, `bracket` deriveds),
  - 🔮 Probabilidades (server `odds`),
  - 🎯 Cuadro interactivo (`koChoice` rune → `resolveTree` → `koProjection`),
    **gated: only appears once R32 is fully finished.**
  100% inline styles, no `<style>` block.
- `src/lib/server/simulator-data.ts` — loads the payload. Ships group `matches`,
  everyone's group `picks` + `orders` always (when `betsLocked`). Ships `koMatches`,
  `bracketEntries`, `odds` **only when `r32AllDone`**.

## Design

### 1. Unified cascade engine (`knockout-odds.ts` + `sim-bracket.ts`)

Bridge the two halves with **one generalized cascade** so a pick flows
group → R32 → R16 → QF → SF → Final/3rd in a single pass.

**1a. Generalize the tree resolver.** Add `resolveUnifiedTree` beside `resolveTree`
(keep `resolveTree` for the odds enumerator's existing call sites, or refactor
`resolveTree` to delegate — implementer's choice, but do not break
`computeKnockoutOdds`). The generalized resolver:

- **Accepts the 16 R32 matchups as input** — an array of `{ a: number|null, b: number|null }`
  pairs — instead of reading finished R32 internally.
- **Makes R32 a pickable round.** For each R32 tie: if a real DB R32 match exists and
  is finished, use its real winner; otherwise use `choose(m, a, b)` (the user's pick).
- `pw.r32` therefore includes **chosen** R32 winners (so R32 picks score), not just
  finished ones.
- R16→Final/3rd cascade is unchanged from today.
- Progressive reveal is inherent: a slot with `a` or `b` still `null` is undecided
  and does not propagate — its downstream ties stay hidden.

**1b. Feed R32 from projected groups.** The R32 matchups come from the existing
`buildR32(...)` fed by projected group tables (real results + group `1/X/2` sims) —
the logic already in `Simulator.svelte`'s `bracket` derived. Where a real DB R32
match is finished, its actual teams/result override the projection (the projection
and the real draw agree on teams once groups finish; the real match also carries the
played result).

**1c. R32 slot → team resolution.** `buildR32` returns `SlotTeam.teamId` (null until
the group is complete). Map those to the `{a, b}` pairs the resolver consumes. Third-
place wildcard slots stay approximate (existing `assignThirds` bipartite matching),
exactly as the current group-projection view already labels them.

### 2. Combined "Pendientes" ordering

One ordered left-column list of undecided items:

1. **Pending group matches** (`1/X/2`), grouped by kickoff date (as today's group tab).
2. **R32 ties** with both participants known (from projected/real groups) and not finished — pickable winner.
3. **R16 / QF / SF / Final / 3rd** ties, each revealed once both feeders have a winner.

### 3. Unified projected leaderboard (right column)

One projection scoring **group and knockout points together** per entry:

```
projTotal(entry)  = scoreEntry(entry, tree).pts + groupSimPoints(entry)
projCorrect(entry) = scoreEntry(entry, tree).correct + groupSimCorrect(entry)
```

No double-counting:

- `base = total_score − realizedKO` (already how `bracketEntries` computes it): all KO
  points are re-simulated from scratch, so realized KO is removed and `scoreEntry`
  re-adds the simulated KO total.
- `groupSimPoints` adds points **only for undecided group items** — `match_outcome`
  for a simulated `1/X/2` that matches the entry's pick, and `group_position` for a
  group the sim fully completes (via `rankGroup`, as today's `projection`). Finished
  group matches are already in `total_score`, so they are never re-added.
- Ranking/tiebreak: sort by `projTotal` then `projCorrect` then `base`, dense-ranked;
  movement `▲/▼` is `baseRank − projRank` vs. the live standings.

A zero-pick projection must equal the live standings (regression-tested).

### 4. UI (`Simulator.svelte`)

- **Two tabs** replace three: **Simulador** (the fused view) and **🔮 Probabilidades**
  (unchanged).
- **Two-column grid**: left = the "Pendientes" list; right = the projected
  leaderboard. Collapses to a single column on narrow screens.
- Because responsive columns need media queries and the file is currently 100% inline
  styles, add a **small scoped `<style>` block** for the grid/breakpoint and the mobile
  impact bar. The rest of the markup stays inline to match the file's idiom.
- **The extras:**
  - **"Solo cambios"** toggle — show only leaderboard entries whose rank or points moved.
  - **Mobile impact bar** — fixed bottom bar (narrow screens only) with the current
    user's projected position and how many people they pass / drop below.
  - **"Pronóstico de {member}"** — a member picker that auto-fills every pending group
    `1/X/2` from `data.picks[predId]` and every bracket slot from the member's
    `bracketEntries` picks. Because KO ties unlock as rounds resolve, fill iteratively
    to a fixpoint (bounded passes, as porra's `loadMeForecast` does): each pass fills
    newly-revealed ties with that member's pick until the forecast is fully laid out.
    Selecting "nadie"/clearing resets to an empty sim.

### 5. Server (`simulator-data.ts`)

- Move the `koMatches` (KO template rows for r32/r16/qf/sf/3rd/final) and
  `bracketEntries` (per-entry `base`, `baseCorrect`, bracket `picks`) computation
  **out of the `r32AllDone` gate** so they ship whenever `betsLocked`. Pre-R32 the R32
  DB rows have null teams — fine, the client builds R32 from projected groups.
- Keep the **odds enumeration** (`computeKnockoutOdds`) gated behind `r32AllDone` — it
  is the expensive part and only meaningful late. The 60s cache stays.
- No schema changes. All queries stay `SELECT`-only. Prod stays read-only throughout.

## Testing

Per CLAUDE.md, any cascade/scoring change ships with a regression test. Add to
`src/lib/knockout-odds.test.ts` (and `sim-bracket.test.ts` if needed):

1. **Cascade stale-pick invalidation** — pick an R32/R16 winner, then change an
   upstream group result so that team no longer arrives; the downstream pick must not
   score (auto-cleared), and standings must recompute.
2. **3rd-place consolation gating** — a correctly-picked losing finalist earns
   `knockout_final` only once the final is decided; 3rd-place winner earns
   `third_place` only when the 3rd match is resolved.
3. **Zero-pick == live standings** — no sims → projected leaderboard equals current
   `total_score` order.
4. **Group→R32 cascade** — simulating a full group produces the expected R32
   participants, and a chosen R32 winner scores `knockout_r32` for entries who picked it.
5. **R32 occupant rule preserved** — a wildcard even slot whose odd sibling is filled
   never scores (existing `prepEntry` behavior) after generalization.

Gate: `npm run check` and `npm test` both pass. Manually drive the tab locally against
a **scratch DB** (never prod) to confirm progressive reveal and the member-forecast fill.

## Risks / notes

- The **known 3rd-place / cascade-stale-pick bug class** lives exactly here — the
  regression tests above are mandatory, not optional.
- `resolveTree` has two callers (odds enumerator + interactive). Generalizing must not
  change odds output; verify the odds tab still matches before/after on a fixed fixture.
- Projected-vs-real R32 agreement: once groups finish, `buildR32` and the real draw put
  the same teams in each slot; the real DB match additionally carries the result. The
  overlay must prefer the real finished result where present.
