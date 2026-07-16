# Settled Podium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show which podium positions (1st–3rd) can no longer change in a pool, with prize money attached when the pool has a buy-in.

**Architecture:** Extend `computeStakes` in `src/lib/stakes.ts`, which already enumerates every still-possible future exhaustively. Inside that existing loop, record the occupant set of dense ranks 1–3 per future; a position is settled iff its set is identical across all futures. Prize invariance is tracked the same way but separately, because money follows finishing place while the display follows dense rank. The banner renders the result.

**Tech Stack:** TypeScript, Svelte 5 (runes: `$props`, `$derived`), SvelteKit, Vitest. `src/lib/stakes.ts` and `src/lib/prizes.ts` are pure and framework-free — no DB, no I/O.

**Spec:** `docs/superpowers/specs/2026-07-16-settled-podium-design.md`

## Global Constraints

- **PRODUCTION IS LIVE.** `.env`'s `DATABASE_URL` points at the live Neon prod DB holding real frozen bets. NEVER run `npm run migrate`, `npm run seed`, `npm run seed:matches`, or `npm run setup`. Any prod access is **read-only SELECTs**.
- This feature requires **no schema change, no migration, and no writes**. If a step seems to need one, stop.
- Prize money is **never** hand-rolled from `PRIZE_SPLITS` percentages — always via `computePrizes`/`prizesByEntryId` in `src/lib/prizes.ts`, so the combined-positions tie rule is honoured.
- Podium means positions **1, 2 and 3 only**. Settled positions below 3rd are not reported.
- Ranking is **dense by points only**; aciertos is *not* a position tiebreak (it only orders display within a tie).
- UI copy is **Spanish**, matching the existing banner.
- `src/lib/stakes.ts` and `src/lib/prizes.ts` stay pure — no imports from `$lib/server/*`.
- Run `npm test` (full suite) after every task, not just the file you touched.

### Verification baselines (measured on this branch's base, commit `f64fb96`)

**`npm run check` reports 593 pre-existing errors. This is normal. Do NOT try to fix them.**
Zero of them cite `stakes.ts`, `stakes.test.ts`, `StakesBanner.svelte` or
`simulator-data.ts`. The gate is **no NEW errors in the files you touched**, never
"0 errors". Check your work with:

```bash
npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'stakes\.ts|stakes\.test\.ts|StakesBanner\.svelte|simulator-data\.ts'
```

Expected output: **empty**. If it is empty, your typecheck has passed.

`npm test` baseline: **404 passing across 41 files.** Task 1 adds 5 tests, Task 2
adds 2 → **411 expected at the end**. Any pre-existing test failure is a red flag:
the baseline is fully green, so a failure means the change broke something.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/lib/stakes.ts` | Modify | Certainty engine. Gains `rankBoard`, `podium`, prize invariance; `champions` semantics fixed. |
| `src/lib/stakes.test.ts` | Modify | Unit tests. All 3 existing tests must keep passing **unchanged**. |
| `src/lib/server/simulator-data.ts` | Modify (`:173`) | Passes `pot` into `computeStakes`. |
| `src/lib/StakesBanner.svelte` | Modify | Renders podium rows + headline; gains `currency` prop. |
| `src/routes/pool/[id]/+page.svelte` | Modify (`:587`) | Passes `currency` to the banner. |

Not touched: `knockout-odds.ts` (cascade/scoring — see CLAUDE.md's known bug class), `prizes.ts`, the inline prize copy at `+page.svelte:173-181`, `src/routes/api/pools/[id]/stakes/+server.ts` (passes `stakes` through opaquely).

## Known limitation (deliberate, do not "fix" in this plan)

`winnersIfHome` / `winnersIfAway` keep **intersection** semantics while `champions` moves to set-identity. Within a branch, an entry that is alone 1st in one future and tied 1st in another is still named — the same overstatement `champions` is being fixed for. This is out of scope per the approved spec, which changes the decisive-match lines only insofar as they adopt the shared ranking helper. Leave a code comment marking the asymmetry so it reads as a known gap, not an oversight. Raise it as a follow-up; do not expand scope here.

## Test fixture gotcha (read before writing any test)

`resolveTree` derives the 3rd-place match's participants from the **SF losers**, and an SF's loser is computed from its `(a, b)` participants — which come from the **QF winners**. The existing `finalOnlyMatches()` fixture has no QF rows, so `a`/`b` are `null` and the loser is `null`.

Verified behaviour: adding an unfinished `'3rd'` match to that fixture yields `third = {a: null, b: null, winner: null}` in every future, and `pw['3rd']` is empty — **`third_place` never scores and the test passes vacuously.**

Any test that needs a real 3rd-place playoff MUST finish the QF round. `finalAndThirdMatches()` in Task 1 does this. Bit order in the 4 futures is **bit 0 = final, bit 1 = 3rd** (`PHASE_ORDER` puts `final` before `3rd`).

---

### Task 1: Ranking helper, podium positions, and `champions` set-identity

**Files:**
- Modify: `src/lib/stakes.ts`
- Test: `src/lib/stakes.test.ts`

**Interfaces:**
- Consumes: `groupByPhase`, `undecidedMatches`, `resolveTree`, `prepEntry`, `scoreEntry`, `OddsMatchIn`, `OddsEntryIn` from `./knockout-odds.js` (all already imported).
- Produces:
  - `interface StakesPodiumRow { position: number; names: string[]; prize: number | null }`
  - `StakesResponse` gains `podium: StakesPodiumRow[]`; keeps `champions: string[] | null`.
  - `rankBoard(scored: {k,pts,correct}[]) => {k,pts,rank}[]` — module-private.
  - `computeStakes` signature unchanged this task (`opts?: { maxExact?: number }`). `prize` is hardcoded `null`; Task 2 implements it.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/stakes.test.ts`. Leave the three existing tests untouched.

```ts
// Both SFs decided (1 and 2 reached the final; 9 and 8 lost and meet in the
// 3rd-place playoff). The QF round MUST be finished, or the SF losers resolve to
// null and the 3rd-place match silently never scores — see the plan's fixture
// gotcha. Undecided: the final and the 3rd-place match → 4 futures.
function finalAndThirdMatches(): OddsMatchIn[] {
  const m = (phase: any, index: number, extra: Partial<OddsMatchIn>): OddsMatchIn => ({
    phase, index, finished: false, homeTeamId: null, awayTeamId: null,
    homeScore: null, awayScore: null, penaltyWinnerId: null, ...extra,
  });
  return [
    m('qf', 0, { finished: true, homeTeamId: 1, awayTeamId: 11, homeScore: 1, awayScore: 0 }),
    m('qf', 1, { finished: true, homeTeamId: 9, awayTeamId: 12, homeScore: 1, awayScore: 0 }),
    m('qf', 2, { finished: true, homeTeamId: 2, awayTeamId: 13, homeScore: 1, awayScore: 0 }),
    m('qf', 3, { finished: true, homeTeamId: 8, awayTeamId: 14, homeScore: 1, awayScore: 0 }),
    m('sf', 0, { finished: true, homeTeamId: 1, awayTeamId: 9, homeScore: 2, awayScore: 0 }),
    m('sf', 1, { finished: true, homeTeamId: 2, awayTeamId: 8, homeScore: 1, awayScore: 0 }),
    m('final', 0, { homeTeamId: 1, awayTeamId: 2 }),
    m('3rd', 0, { homeTeamId: 9, awayTeamId: 8 }),
  ];
}
// Parallel to finalAndThirdMatches(), in the same order.
const META8 = [
  { id: 201, kickoff: null }, { id: 202, kickoff: null },
  { id: 203, kickoff: null }, { id: 204, kickoff: null },
  { id: 205, kickoff: null }, { id: 206, kickoff: null },
  { id: 207, kickoff: '2026-07-19T19:00:00Z' }, // final
  { id: 208, kickoff: '2026-07-18T19:00:00Z' }, // 3rd place
];
const entry = (id: number, name: string, base: number, picks: any[] = [], baseCorrect = 0): OddsEntryIn =>
  ({ id, userId: id, name, label: null, base, baseCorrect, picks });

describe('computeStakes — settled podium', () => {
  it('reports a full podium when the leaders move in lockstep', () => {
    // Identical picks, different bases: every future adds the same points to all
    // four, so the gaps (5, 6, 4 — example gaps) never close.
    const picks = [{ phase: 'final', slot: 1, teamId: 1 }, { phase: '3rd', slot: 1, teamId: 9 }];
    const entries = [
      entry(10, 'Ana', 100, picks), entry(20, 'Ben', 95, picks),
      entry(30, 'Cid', 89, picks), entry(40, 'Dan', 85, picks),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team)!;
    expect(s.podium).toEqual([
      { position: 1, names: ['Ana'], prize: null },
      { position: 2, names: ['Ben'], prize: null },
      { position: 3, names: ['Cid'], prize: null },
    ]);
    expect(s.champions).toEqual(['Ana']); // Dan is settled at 4th but not reported
  });

  it('locks 1st while the 3rd-place playoff still swings 2nd and 3rd', () => {
    // Ben's only pick is the 3rd-place winner, worth 6. If 9 wins he is 2nd; if 8
    // wins he drops below Cid. Exercises the 3rd-place match moving the podium.
    const entries = [
      entry(10, 'Ana', 100),
      entry(20, 'Ben', 0, [{ phase: '3rd', slot: 1, teamId: 9 }]),
      entry(30, 'Cid', 3),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team)!;
    expect(s.podium).toEqual([{ position: 1, names: ['Ana'], prize: null }]);
    expect(s.champions).toEqual(['Ana']);
  });

  it('locks 3rd while 1st is still open, and still reports the decisive match', () => {
    // Ana and Ben swap 1st/2nd on the final's result; Cid is 3rd in every future.
    const entries = [
      entry(10, 'Ana', 0, [{ phase: 'final', slot: 1, teamId: 1 }]),
      entry(20, 'Ben', 0, [{ phase: 'final', slot: 1, teamId: 2 }]),
      entry(30, 'Cid', 5), entry(40, 'Dan', 4),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team)!;
    expect(s.podium).toEqual([{ position: 3, names: ['Cid'], prize: null }]);
    expect(s.champions).toBeNull();
    expect(s.matches).toHaveLength(1);         // the final decides the pool
    expect(s.matches[0].phase).toBe('final');
  });

  it('shares 1st on a points tie — aciertos is not a position tiebreak', () => {
    // Level on points in every future; Ana has more correct picks. The old
    // points-then-correct sort would name Ana alone.
    const entries = [entry(10, 'Ana', 10, [], 5), entry(20, 'Ben', 10, [], 0)];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team)!;
    expect(s.champions).toEqual(['Ana', 'Ben']);
    expect(s.podium).toEqual([{ position: 1, names: ['Ana', 'Ben'], prize: null }]);
  });

  it('does not call 1st settled when the leader is alone in one future and tied in another', () => {
    // final=1 → Ana 14 alone; final=2 → Ben 14, tying Ana. The old intersection
    // logic returns ['Ana'] here, overstating a shared 1st as an outright win.
    const entries = [
      entry(10, 'Ana', 14, [], 1),
      entry(20, 'Ben', 0, [{ phase: 'final', slot: 1, teamId: 2 }]),
    ];
    const s = computeStakes(finalOnlyMatches(), entries, RULES, META, team)!;
    expect(s.champions).toBeNull();
    expect(s.podium.find((r) => r.position === 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/stakes.test.ts`
Expected: the 5 new tests FAIL (`s.podium` is `undefined`); the 3 existing tests PASS.

- [ ] **Step 3: Add the types and the ranking helper**

In `src/lib/stakes.ts`, replace the `StakesResponse` interface (currently lines 26-30) with:

```ts
export interface StakesPodiumRow {
  /** Dense rank: 1 | 2 | 3. */
  position: number;
  /** Display order within a tie (entries order = total_score desc). */
  names: string[];
  /** null = not invariant across futures, or a free pool. */
  prize: number | null;
}
export interface StakesResponse {
  /** Names guaranteed 1st no matter what; null if still open. Projection of `podium`. */
  champions: string[] | null;
  /** Settled podium positions only. May be empty or partial. */
  podium: StakesPodiumRow[];
  matches: StakesMatch[];
}

/** One entry's score in one future. */
interface Scored { k: number; pts: number; correct: number }

/**
 * The leaderboard's ranking, exactly: sort by points desc (correct-pick count
 * only orders DISPLAY within a tie), then DENSE-rank by points alone, so entries
 * level on points share a position. Mirrors leaderboardRanks in
 * routes/pool/[id]/+page.svelte and computeUnifiedProjection in sim-projection.ts
 * — aciertos is NOT a position tiebreak.
 */
function rankBoard(scored: Scored[]): { k: number; pts: number; rank: number }[] {
  const order = scored.slice().sort((a, b) => b.pts - a.pts || b.correct - a.correct);
  let rank = 0;
  let prev: number | null = null;
  return order.map((o) => {
    if (prev === null || o.pts !== prev) { rank += 1; prev = o.pts; }
    return { k: o.k, pts: o.pts, rank };
  });
}
```

- [ ] **Step 4: Track podium occupants in the enumeration loop**

In `computeStakes`, delete the `globalInter` declaration (line 70) and add after the `part` declaration (line 75):

```ts
  // Podium: position p (1..3) is settled iff its occupant SET is identical in
  // EVERY future. Canonicalise each future's set as a sorted-id key and compare.
  // Deliberately NOT an intersection: an entry alone 1st in one future and tied
  // 1st in another has NOT settled 1st — they would split the pot.
  const posKey: (string | undefined)[] = [undefined, undefined, undefined];
  const posIds: number[][] = [[], [], []];
  const posSettled: boolean[] = [true, true, true];
```

Change the `scored` declaration (line 77) to use the named type:

```ts
  const scored: Scored[] = new Array(entries.length);
```

Replace the rank-1 block (lines 92-100) with:

```ts
    const ranked = rankBoard(scored);
    const winners = ranked.filter((r) => r.rank === 1).map((r) => entries[r.k].id);

    for (let p = 1; p <= 3; p++) {
      const ids = ranked.filter((r) => r.rank === p).map((r) => entries[r.k].id).sort((a, b) => a - b);
      const key = ids.join(',');
      if (posKey[p - 1] === undefined) { posKey[p - 1] = key; posIds[p - 1] = ids; }
      else if (posKey[p - 1] !== key) posSettled[p - 1] = false;
    }
```

Delete the `globalInter = intersect(globalInter, winners);` line (line 102). Leave the `part` / `homeInter` / `awayInter` loop that follows exactly as it is — `winners` still feeds it.

- [ ] **Step 5: Build the podium and derive `champions`**

Replace the `champions` line (line 120) with:

```ts
  const podium: StakesPodiumRow[] = [];
  for (let p = 1; p <= 3; p++) {
    if (!posSettled[p - 1]) continue;
    const ids = posIds[p - 1];
    if (ids.length === 0) continue; // position doesn't exist (pool smaller than 3)
    podium.push({ position: p, names: namesOf(new Set(ids))!, prize: null });
  }
  // ONE source of truth: champions is a projection of the podium, so the two can
  // never disagree.
  const champions = podium.find((r) => r.position === 1)?.names ?? null;
```

Add a comment above the `matches.push` block (near line 130) marking the known asymmetry:

```ts
  // NOTE: winnersIfHome/winnersIfAway keep INTERSECTION semantics, unlike
  // champions/podium which use set-identity. Within a branch, an entry alone 1st
  // in one future and tied 1st in another is still named here. Known gap, out of
  // scope by design — see docs/superpowers/specs/2026-07-16-settled-podium-design.md.
```

Update the return (line 142) to `return { champions, podium, matches };`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/lib/stakes.test.ts`
Expected: PASS — all 8 tests (3 existing unchanged + 5 new).

**If any of the 3 existing tests needed editing, STOP.** They are the evidence that the ranking change is behaviour-preserving on shipped cases; a failure there means the design is wrong, not the test.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test`
Expected: **409 passing** (404 baseline + 5 new).

Then: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'stakes\.ts|stakes\.test\.ts|simulator-data\.ts'`
Expected: **empty output**. (The suite has 593 pre-existing errors elsewhere — see Verification baselines. Do not fix them.) `simulator-data.ts` still compiles because it reads `.stakes` opaquely and never names `champions`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/stakes.ts src/lib/stakes.test.ts
git commit -m "feat(stakes): report settled podium positions (1st-3rd)

Rank by the leaderboard's rule (dense, points only) instead of
points-then-correct, so the banner cannot contradict the Clasificación
on a tie. A position is settled iff its occupant set is identical in
every enumerated future; champions becomes a projection of that, fixing
an intersection that overstated a shared 1st as an outright win."
```

---

### Task 2: Prize money per settled row

**Files:**
- Modify: `src/lib/stakes.ts`
- Test: `src/lib/stakes.test.ts`

**Interfaces:**
- Consumes: `computePrizes(scoresDesc: number[], pot: number) => number[]` from `./prizes.js` — returns per-entry shares aligned index-for-index with a DESC-sorted score list. `rankBoard`, `StakesPodiumRow` from Task 1.
- Produces: `computeStakes(..., opts?: { maxExact?: number; pot?: number })`. `StakesPodiumRow.prize` is now populated.

- [ ] **Step 1: Write the failing tests**

Add inside the `describe('computeStakes — settled podium')` block:

```ts
  it('attaches prize money to settled rows when there is a pot', () => {
    const picks = [{ phase: 'final', slot: 1, teamId: 1 }, { phase: '3rd', slot: 1, teamId: 9 }];
    const entries = [
      entry(10, 'Ana', 100, picks), entry(20, 'Ben', 95, picks),
      entry(30, 'Cid', 89, picks), entry(40, 'Dan', 85, picks),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team, { pot: 100 })!;
    expect(s.podium).toEqual([
      { position: 1, names: ['Ana'], prize: 60 },
      { position: 2, names: ['Ben'], prize: 25 },
      { position: 3, names: ['Cid'], prize: 15 },
    ]);
  });

  it('withholds money when the position is locked but the payout is not', () => {
    // Dan is 3rd in every future, but Cid swings between 4 (below Dan) and 10
    // (tied with Ben). That tie ABOVE Dan changes his finishing PLACE from 2 to
    // 3 — and pcts[3] is 0 — so his money moves while his position does not.
    const entries = [
      entry(10, 'Ana', 20), entry(20, 'Ben', 10),
      entry(30, 'Cid', 4, [{ phase: '3rd', slot: 1, teamId: 9 }]),
      entry(40, 'Dan', 5),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team, { pot: 100 })!;
    expect(s.podium).toEqual([
      { position: 1, names: ['Ana'], prize: 60 },
      { position: 3, names: ['Dan'], prize: null }, // locked at 3rd, money 15 or 0
    ]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/stakes.test.ts`
Expected: FAIL — both new tests get `prize: null` where money is expected (and `computeStakes` rejects the 6th argument's `pot` key under `npm run check`).

- [ ] **Step 3: Implement prize tracking**

In `src/lib/stakes.ts`, add to the imports:

```ts
import { computePrizes } from './prizes.js';
```

Widen the `opts` parameter:

```ts
  opts?: { maxExact?: number; pot?: number },
```

Add after the `posSettled` declaration from Task 1:

```ts
  // Prize invariance is tracked SEPARATELY from whether a position is settled.
  // computePrizes assigns by FINISHING PLACE (array index), while the board
  // displays DENSE rank — so a tie above an entry changes its place, and its
  // money, while its displayed position stays put.
  const pot = opts?.pot ?? 0;
  const idxById = new Map<number, number>();
  entries.forEach((e, k) => idxById.set(e.id, k));
  const prizeFirst: (number | undefined)[] = new Array(entries.length).fill(undefined);
  const prizeVaries: boolean[] = new Array(entries.length).fill(false);
```

Add inside the loop, right after the podium `for (let p = 1; p <= 3; p++)` block:

```ts
    // `ranked` is already sorted points-desc with ties adjacent, which is exactly
    // what computePrizes requires.
    if (pot > 0) {
      const prizes = computePrizes(ranked.map((r) => r.pts), pot);
      for (let i = 0; i < ranked.length; i++) {
        const k = ranked[i].k;
        if (prizeFirst[k] === undefined) prizeFirst[k] = prizes[i];
        else if (prizeFirst[k] !== prizes[i]) prizeVaries[k] = true;
      }
    }
```

Add above the podium-building loop:

```ts
  const rowPrize = (ids: number[]): number | null => {
    if (pot <= 0) return null;
    let v: number | null = null;
    for (const id of ids) {
      const k = idxById.get(id)!;
      if (prizeVaries[k]) return null;
      const p = prizeFirst[k];
      if (p === undefined) return null;
      if (v === null) v = p;
      else if (v !== p) return null; // tied members should share equally; belt and braces
    }
    return v;
  };
```

Change the `podium.push` to use it:

```ts
    podium.push({ position: p, names: namesOf(new Set(ids))!, prize: rowPrize(ids) });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/stakes.test.ts`
Expected: PASS — all 10 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test`
Expected: **411 passing** (409 + 2 new).

Then: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'stakes\.ts|stakes\.test\.ts'`
Expected: **empty output**. (593 pre-existing errors elsewhere are expected — do not fix them.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/stakes.ts src/lib/stakes.test.ts
git commit -m "feat(stakes): attach prize money to settled podium rows

Money is tracked for invariance separately from the position: prizes go
by finishing place while the board shows dense rank, so a tie above an
entry can move its payout without moving its position. A row whose prize
is not identical across every future renders without a figure."
```

---

### Task 3: Wire the pot through and render the podium

**Files:**
- Modify: `src/lib/server/simulator-data.ts:173-176`
- Modify: `src/lib/StakesBanner.svelte`
- Modify: `src/routes/pool/[id]/+page.svelte:587`

**Interfaces:**
- Consumes: `StakesResponse`/`StakesPodiumRow` shape from Tasks 1-2; `fmtMoney(n: number, currency: string) => string` from `$lib/prizes.js`.
- Produces: `<StakesBanner {stakes} currency={pool.currency} />`.

No unit test: this repo has no Svelte component test harness (no `@testing-library/svelte`; `vitest.config.ts` includes only `src/**/*.test.ts`). Task 4 verifies it end-to-end.

- [ ] **Step 1: Pass the pot from the server**

In `src/lib/server/simulator-data.ts`, replace the `computeStakes` call (lines 173-176) with:

```ts
    stakes = computeStakes(koMatches, oddsEntries, scoring, koMeta, (id: number) => ({
      name: (teams as Record<number, any>)[id]?.name ?? '?',
      flag: (teams as Record<number, any>)[id]?.flag_code ?? '',
    }), { pot: (Number(pool.buy_in) || 0) * entries.length });
```

The pot is buy-in × entry count, assuming every bet is paid — mirroring `Simulator.svelte:145`. Zero buy-in → no pot → no money shown anywhere.

- [ ] **Step 2: Render the podium in the banner**

In `src/lib/StakesBanner.svelte`, replace the `<script>` block's interfaces and props (lines 8-16) with:

```ts
  interface StakesTeam { name: string; flag: string }
  interface StakesMatch {
    id: number; phase: string; kickoff: string | null;
    home: StakesTeam; away: StakesTeam;
    winnersIfHome: string[] | null; winnersIfAway: string[] | null;
  }
  interface StakesPodiumRow { position: number; names: string[]; prize: number | null }
  interface StakesResponse {
    champions: string[] | null;
    podium: StakesPodiumRow[];
    matches: StakesMatch[];
  }

  let { stakes, currency = 'EUR' }:
    { stakes: StakesResponse | null; currency?: string } = $props();
```

Add `fmtMoney` to the imports at the top of the `<script>`:

```ts
  import { fmtMoney } from '$lib/prizes.js';
```

Add after the `decisive` derivation (line 26):

```ts
  const POS_LABEL: Record<number, string> = { 1: '1.º', 2: '2.º', 3: '3.º' };
  const podium = $derived(stakes?.podium ?? []);
  const headline = $derived(
    stakes?.champions && podium.length === 3 ? 'PODIO YA DECIDIDO'
    : stakes?.champions ? 'LA QUINIELA YA TIENE GANADOR'
    : 'PODIO — EN PARTE DECIDIDO'
  );
```

Replace the whole markup block (lines 29-53) with:

```svelte
{#if podium.length > 0}
  <section class="stakes decided">
    <div class="stakes-head"><Icon name="trophy" size={14} stroke={1.8} /> {headline}</div>
    {#each podium as row (row.position)}
      <div class="podium-row">
        <span class="podium-pos">{POS_LABEL[row.position]}</span>
        <strong class="podium-name">{who(row.names)}</strong>
        {#if row.prize != null}
          <span class="podium-prize">{fmtMoney(row.prize, currency)}</span>
        {/if}
      </div>
    {/each}
    <div class="stakes-line">Pase lo que pase — es matemático.</div>
  </section>
{/if}
<!-- The two blocks are no longer mutually exclusive: "2nd and 3rd locked, 1st
     still in play" needs both. But once 1st is settled the lines are noise —
     both sides would name the same person. -->
{#if !stakes?.champions && decisive.length > 0}
  <section class="stakes">
    <div class="stakes-head"><Icon name="trophy" size={14} stroke={1.8} /> QUÉ SE JUEGA LA QUINIELA</div>
    {#each decisive as m (m.id)}
      <div class="stakes-match">
        <span class="stakes-phase">{PHASE_LABEL[m.phase] ?? m.phase}</span>
        <div class="stakes-sides">
          <span class="stakes-side">
            Si gana {@html m.home.flag ? flagEmoji(m.home.flag) : ''} <b>{shortName(m.home.name)}</b>
            → {#if m.winnersIfHome}<Icon name="trophy" size={13} stroke={1.8} /> <strong>{who(m.winnersIfHome)}</strong>{:else}aún abierto{/if}
          </span>
          <span class="stakes-side">
            Si gana {@html m.away.flag ? flagEmoji(m.away.flag) : ''} <b>{shortName(m.away.name)}</b>
            → {#if m.winnersIfAway}<Icon name="trophy" size={13} stroke={1.8} /> <strong>{who(m.winnersIfAway)}</strong>{:else}aún abierto{/if}
          </span>
        </div>
      </div>
    {/each}
  </section>
{/if}
```

Add to the `<style>` block, after `.decided .stakes-line` (line 69):

```css
  .podium-row {
    display: flex; align-items: baseline; gap: 8px;
    font-size: 14px; padding: 3px 0;
  }
  .podium-row + .podium-row { border-top: 1px solid rgba(201, 168, 76, 0.14); }
  .podium-pos {
    font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
    color: var(--text-muted); min-width: 24px;
  }
  .podium-name { color: var(--gold); }
  .podium-prize { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--green); }
  .decided .stakes-line { margin-top: 8px; font-size: 12px; color: var(--text-muted); }
```

- [ ] **Step 3: Pass the currency from the page**

In `src/routes/pool/[id]/+page.svelte`, change line 587:

```svelte
    <StakesBanner {stakes} currency={pool.currency} />
```

- [ ] **Step 4: Typecheck and run the full suite**

Run: `npm test`
Expected: **411 passing**, unchanged from Task 2 (this task adds no tests).

Then: `npm run check 2>&1 | grep -E '^[0-9]+ ERROR' | grep -E 'StakesBanner\.svelte|simulator-data\.ts|pool/\[id\]/\+page\.svelte'`
Expected: **empty output**. (593 pre-existing errors elsewhere are expected — do not fix them. Note `+page.svelte` is a large file; confirm any error citing it is not yours by comparing against `git stash`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/simulator-data.ts src/lib/StakesBanner.svelte src/routes/pool/\[id\]/+page.svelte
git commit -m "feat(pool): show the settled podium in the stakes banner

Rows for each locked podium position, with prize money when the pool has
a buy-in. The decisive-match lines now hide once 1st is settled (both
sides would name the same person) but coexist with the podium block when
1st is still open."
```

---

### Task 4: End-to-end verification

**Files:** none modified. Verification only.

- [ ] **Step 1: Confirm the engine agrees with the independent probe**

Write `/private/tmp/claude-501/-Users-jsr-world-cup-pool/73e382fa-a082-4f0e-a856-1e49bd89c675/scratchpad/verify-podium.mts`. **READ-ONLY: SELECTs only.**

```ts
// READ-ONLY prod probe. SELECTs only. No INSERT/UPDATE/DELETE/DDL.
import '/Users/jsr/world-cup-pool/src/lib/server/load-env.js';
import { getPool } from '/Users/jsr/world-cup-pool/src/lib/server/db.js';
import { getSimulatorData } from '/Users/jsr/world-cup-pool/src/lib/server/simulator-data.js';

// Example pool (id 1). userId 0 would fail the membership gate, so use the creator.
const { rows } = await getPool().query('SELECT created_by FROM pools WHERE id = 1');
const res: any = await getSimulatorData(1, Number(rows[0].created_by));
console.log('stakes.champions:', res.stakes?.champions);
console.log('stakes.podium:', JSON.stringify(res.stakes?.podium, null, 2));
console.log('oddsMeta:', res.oddsMeta);
await getPool().end();
```

Run: `npx tsx /private/tmp/claude-501/-Users-jsr-world-cup-pool/73e382fa-a082-4f0e-a856-1e49bd89c675/scratchpad/verify-podium.mts`

Expected: `oddsMeta.exact === true` with `remaining: 2`; `champions` is `["A"]`; `podium` is three rows — A 1st, B 2nd, C 3rd — each with a non-null `prize`. This must match the independent read-only probe run during design. **If `podium` is empty or `exact` is false, stop and investigate — do not adjust the expectation to fit.**

- [ ] **Step 2: Verify the banner renders**

Use the `verify` skill, or run `npm run dev` and open pool 1's Clasificación tab. Expected: a gold banner headed `PODIO YA DECIDIDO` listing A / B / C with euro amounts, and **no** "QUÉ SE JUEGA LA QUINIELA" block below it (1st is settled, so the decisive lines are correctly suppressed).

Read-only note: viewing the pool page issues SELECTs only. Do not trigger any admin action (recalculate, results, sync-scores) — those WRITE.

- [ ] **Step 3: Final full check**

Run: `npm test`
Expected: **411 passing across 41 files** (404 baseline + 7 new).

Then: `npm run check 2>&1 | grep -cE '^[0-9]+ ERROR'`
Expected: **593 or fewer** — the pre-existing baseline, unchanged. Do not fix pre-existing errors.

- [ ] **Step 4: Commit any fixes**

Only if steps 1-3 surfaced problems. Otherwise nothing to commit.
