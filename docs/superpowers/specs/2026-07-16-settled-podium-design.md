# Settled podium — "quién está fijo" in the stakes banner

**Date:** 2026-07-16
**Status:** Implemented on `feat/settled-podium`. **Two decisions below were
overridden during the final review — see "Amendments" before trusting this doc.**

## Amendments (2026-07-16, post final review — these WIN over the text below)

1. **`winnersIfHome`/`winnersIfAway` now use set-identity, not intersection.**
   The "Known limitation" framing below is obsolete and its premise expired.
   Moving `winners` to points-only ranking widened the per-future rank-1 set, so
   intersections that were previously empty became non-empty — manufacturing
   *new* false "es matemático" claims the base commit never emitted, which the
   `champions` gate then displayed. That was a regression, not a pre-existing
   gap. The per-branch winners now track a sorted-id key per (side, match) and
   emit only when identical across every future in that branch. Set-identity is
   strictly stronger than intersection, so it can only ever remove false claims.
   Do NOT restore intersection semantics here.

2. **A bracketed unsettled position DOES render an `— aún en juego` placeholder.**
   The "no placeholder rows" decision below stands only for *trailing* gaps,
   where the position may not exist (a 2-entry pool has no 3rd). When a position
   is bracketed by settled positions above and below, it provably exists, and
   suppressing it rendered a hole that read as a bug. The rule is implemented in
   `StakesBanner.svelte`, not the engine.

Known follow-up, not implemented: a *leading* gap (e.g. `podium = [{2}]`) still
renders with 1st silently absent. Dense ranks are contiguous, so a settled 2nd
does prove a 1st exists — the bracketed-only rule is conservative there.

## Problem

With two matches left in WC2026 (the final and the 3rd-place playoff), an example
pool has its top four positions mathematically settled: A 1st, B 2nd, C 3rd, D
4th. The four move in lockstep — they gain identical points in all four remaining
futures — so the gaps between them never close, and 5th place cannot reach 4th's
floor no matter how the two remaining matches go.

The app does not surface this. `computeStakes` (`src/lib/stakes.ts`) only
computes `champions` — the entries that finish 1st in every future — so the
banner announces that A has clinched, and says nothing about 2nd or 3rd being
locked. Since `PRIZE_SPLITS` pays 1st/2nd/3rd at 60/25/15, in this pool every euro
of the pot is already decided and nobody is told.

## Goal

Report which podium positions (1st–3rd) can no longer change, with the prize
money attached when the pool has a buy-in.

## Scope

In scope:

- Settled positions 1–3 only. Positions below the podium are not reported, even
  when settled (a real pool can also have 4th and several lower places locked;
  they carry no prize and would bury the signal).
- Partial results: report each podium position as soon as it locks, leaving the
  rest open.
- Prize money per settled row, when `buy_in > 0`.

Out of scope:

- The per-match "si gana X → Y" lines keep naming only the pool winner. They are
  not generalised to 2nd/3rd.
- The inline copy of the prize maths at `src/routes/pool/[id]/+page.svelte:173`
  is left alone.
- No schema change, no migration, no writes of any kind.

## Key decisions

### Ranking: one rule everywhere

The app's Clasificación (`+page.svelte:110-120`, mirrored by
`sim-projection.ts:71-74`) ranks **densely by points only** — entries level on
points share a position, and aciertos is explicitly *not* a position tiebreak.
`stakes.ts:94` instead ranks by points-then-correct. This is a latent bug in
shipped code: on a points tie the banner would crown a single champion while the
leaderboard shows a shared 1st.

`stakes.ts` moves to a single shared ranking helper implementing the
leaderboard's rule: sort by points desc with correct-count as *display* order
within a tie (mirroring `sim-projection.ts:67`), then dense-rank by points only.
Both the podium and the existing decisive-match logic use it, so the banner
cannot contradict itself.

### "Settled" means set-identity, not intersection

For each future, record the occupant set of dense ranks 1, 2 and 3, canonicalised
as a sorted-id key. **Position p is settled iff that key is identical across
every enumerated future.**

This deliberately differs from today's `champions`, which intersects the rank-1
sets across futures. If an entry is alone 1st in one future but shares 1st in
another, the intersection still names them, and the banner claims they "gana la
quiniela pase lo que pase" — when in fact they might take only half the pot.
Set-identity correctly reports 1st as not settled there.

**`champions` keeps its name**, and its semantics are fixed to set-identity. It
is not a second computation: it is defined as a projection of the podium, so
there is exactly one source of truth and no drift is possible.

```ts
champions = podium.find((p) => p.position === 1)?.names ?? null
```

In this example this changes nothing (A is alone at 1st in all four futures), and
both existing tests that assert on `champions` keep passing unchanged: `['Ana']`
where Ana is alone 1st in both futures, and `null` where Ben and Cid swap 1st
depending on the final.

### Exhaustive enumeration only

The podium is computed inside the existing 2^n loop in `computeStakes`, so it
inherits the guard at `stakes.ts:53`: return `null` unless every remaining
outcome can be enumerated exactly (`n > 0 && 2^n <= maxExact`, default 65536).

This is why the podium is **not** derived from `computeKnockoutOdds`'s
`bestRank`/`worstRank`, which would be nearly free. Those degrade silently to a
50k Monte-Carlo sample above 16 remaining matches, so `clinchedWin` is "won all
50k sampled futures", not a proof. They also rank by points-then-correct, and
`bestRank === worstRank` says *an entry's* position is fixed rather than *who
occupies position p* — which differ under ties.

### Settled position does not imply settled money

`computePrizes` assigns by **finishing place (array index)**; the leaderboard
displays **dense rank**. These diverge on ties. With scores 10, 8, 8, 5 the last
entry displays as "3.º" but sits at index 3, where the split is 0%.

So an entry can hold a locked position while its payout swings: if C is 3rd
in every future but the two above them tie in some of them, C is dense-rank 3
throughout while the prize alternates between 15% and nothing.

Prize invariance is therefore computed separately. Per future, run
`computePrizes` over the full board sorted desc; a podium row shows money only
if that entry's prize is identical across every future, otherwise `prize: null`
and the row renders with no figure. Prizes are never hand-rolled from
`PRIZE_SPLITS` percentages — always via `prizes.ts`, so the combined-positions
tie rule is honoured.

### No score on the rows

A settled row cannot show a final score: A's current standing is today's total,
and across the four futures A's final total varies over a range. Today's score is
already visible in the leaderboard directly below. Rows show position, name(s),
and prize only.

## Design

### Engine — `src/lib/stakes.ts`

```ts
export interface StakesPodiumRow {
  position: number;      // 1 | 2 | 3, dense rank
  names: string[];       // display order within a tie
  prize: number | null;  // null = not invariant across futures, or free pool
}

export interface StakesResponse {
  champions: string[] | null;  // kept; = podium[position 1] names, else null
  podium: StakesPodiumRow[];   // settled positions only; may be empty or partial
  matches: StakesMatch[];      // unchanged
}
```

`computeStakes` gains `opts.pot`. `StakesMatch`, `winnersIfHome`/`winnersIfAway`
and the participants-fixed logic (`stakes.ts:103-109`, `:125`) are unchanged
apart from adopting the shared ranking helper.

### Data flow

`simulator-data.ts:173` passes `pot = buy_in × entries.length`, mirroring
`Simulator.svelte:145` (the pot assumes every bet is paid; zero buy-in → no pot →
no money shown). Everything else is untouched: the computation stays inside the
existing 60s process-wide cache, gated on `r32AllDone`, and is served by both the
route loader and `/api/pools/[id]/stakes`.

### UI — `src/lib/StakesBanner.svelte`

Placement unchanged (`+page.svelte:587`, above the leaderboard). The
`{#if stakes?.champions}` branch (`StakesBanner.svelte:29`) keeps its condition
but gains the podium rows beneath the headline, and a third branch is added for
the case where 1st is open but a lower position is locked. Rows render only for
settled positions, reusing the existing `who()` helper so a tie reads "A y B
(empate)". The headline reads `champions`; the rows read `podium`.

No "aún en juego" placeholder rows: the engine cannot tell the banner whether 3rd
place even exists (pool 3 has one entry, pool 2 has two), so an empty 3rd slot
would invent a position. The headline carries incompleteness instead:

| Condition (evaluated in order) | Headline |
|---|---|
| `champions && podium.length === 3` | `PODIO YA DECIDIDO` |
| `champions` | `LA QUINIELA YA TIENE GANADOR` |
| `podium.length > 0` (1st open, something below locked) | `PODIO — EN PARTE DECIDIDO` |

Note the second row absorbs small pools: pool 2 has two entries, so with both
positions locked `podium.length === 2` and it reads `LA QUINIELA YA TIENE
GANADOR` — correct, if not the strongest wording. Pool 3 (one entry) likewise.
No headline claims a full podium unless three positions are actually settled.

The banner gains a `currency` prop from `+page.svelte` (`pool.currency`) and
imports `fmtMoney` from `prizes.ts`. Note `+page.svelte:519` has its own
single-argument `fmtMoney`; it is a different function and is not touched.

**Block gating.** The podium block and the decisive-match lines are no longer
mutually exclusive — "2nd and 3rd locked, 1st still in play" needs both. But when
1st is locked the lines are noise (Pool 1 would print "Si gana España → A / Si
gana Argentina → A"). Rule:

- Podium block: shown whenever `podium.length > 0`.
- Decisive lines: shown only when `champions === null`.

### Error handling

`computeStakes` returns `null` when the enumeration is not exhaustive or nothing
is left to decide; the banner stays silent, as today. A row whose prize is not
invariant renders without a figure rather than guessing. Free pools (`pot <= 0`)
render no money at all.

## Testing

`stakes.test.ts` — all three existing tests keep passing **unchanged**, and that
is itself the check that the ranking fix and the `champions` semantic change are
behaviour-preserving on the cases already shipped. If any of them needs editing,
stop: something is wrong with the design, not the test. New cases:

1. **Full podium** — Pool 1 shape (final + 3rd-place outstanding, leaders moving in
   lockstep) → three settled rows, `champions` naming the leader.
2. **1st locked, 2nd/3rd open** → one podium row; decisive lines **hidden**
   (`champions !== null`).
3. **1st open, 2nd/3rd locked** → two podium rows; decisive lines **rendered**.
   Together with (2) this pins the gating rule from both sides — the two blocks
   are no longer mutually exclusive, but neither are they independent.
4. **Tie at the top** — two entries level on points in every future, one with more
   aciertos → both named at 1st. Regression test for the ranking fix; fails under
   the current points-then-correct sort.
5. **Intersection vs set-identity** — alone 1st in one future, tied 1st in another
   → `champions === null`. Pins the semantic change; today's intersection logic
   would name the entry here.
6. **Prize invariance** — position locked, tie above swings the payout →
   `prize: null`.
7. **Prize happy path** — strict order, pot > 0 → 60/25/15.

At least one test must have the **3rd-place playoff result** move a podium
position, not only the final. Per CLAUDE.md's known-bug-class warning: no cascade
or scoring code (`resolveTree`, `scoreEntry`) is modified, so the 3rd-place
stale-pick surface is untouched — but that match is one of Pool 1's two live
fixtures and `third_place` is worth 6 points, so it is load-bearing here.

Verification: `npm test` (full suite — the ranking change touches shipped
behaviour), `npm run check` for types, and a re-run of the read-only prod probe,
which must independently agree that Pool 1's banner names A, B and C.
