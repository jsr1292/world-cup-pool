# Simulador Unified Cascade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fuse world-cup-pool's group `1/X/2` what-if and interactive knockout Cuadro into one progressive-reveal Simulador (porra-mundial model): a combined "Pendientes" list, a unified projected leaderboard, and the Solo-cambios / mobile impact-bar / Pronóstico-de-{member} extras.

**Architecture:** Reuse world-cup-pool's own primitives (`bracket-2026.ts`, `sim-bracket.ts`, `knockout-odds.ts`). Extract the group→R32 projection into a pure function, generalize the KO tree resolver so R32 becomes a pickable round seeded from projected groups, add a pure unified per-entry scorer, ungate the server payload, then rewrite `Simulator.svelte` around one two-column view.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, TypeScript, Vitest, PostgreSQL (`pg`).

## Global Constraints

- **PROD IS LIVE.** `.env` `DATABASE_URL` is the live Neon prod DB with irreplaceable frozen bets. All work stays **read-only** against prod (SELECT only). NEVER run `npm run migrate|seed|seed:matches|setup`. To drive the app, point `DATABASE_URL` at a **scratch DB** whose host is NOT `neon.tech`.
- **Cascade/scoring is the known bug class** (3rd-place stale-pick). Every change to cascade or scoring ships with a regression test. Run `npm test` after any such change.
- Pure engine modules (`knockout-odds.ts`, `sim-bracket.ts`, `sim-projection.ts`, `group-standings.ts`) stay **framework-free** — no Svelte, no DOM — so they run on client and server and are unit-testable.
- `bracket-2026.ts` is the single source of truth for the FIFA 2026 tree — do NOT add a second bracket definition.
- Scoring must keep mirroring `server/scoring.ts calculateBracketScores` exactly.
- Gate before merge: `npm run check` AND `npm test` both pass.

---

### Task 1: Extract pure group→R32 projection into `sim-bracket.ts`

Move the group-projection logic (currently inline in `Simulator.svelte`'s `bracket` derived + `statsOf` + `groupGsMatches`) into a pure, tested function so the cascade can be unit-tested and the component stays thin.

**Files:**
- Modify: `src/lib/sim-bracket.ts` (add `statsOf`, `GROUPS`, `projectBracket`, `r32Participants`)
- Test: `src/lib/sim-bracket.test.ts` (create or extend)

**Interfaces:**
- Consumes: `rankGroup` + `GsMatch` from `src/lib/group-standings.ts`; existing `rankThirds`, `assignThirds`, `buildR32`, `ThirdInfo`, `R32Matchup` in this file.
- Produces:
  - `GROUPS: string[]` — `['A'..'L']`.
  - `statsOf(gms: GsMatch[]): Record<number, { points: number; gf: number; ga: number }>`
  - `interface GroupProjection { perGroup: Record<string, { complete: boolean; order: number[] | null; played: number }>; thirds: ThirdInfo[]; thirdsRanked: { ranked: ThirdInfo[]; qualifyingGroups: Set<string> }; allComplete: boolean; completeCount: number; r32: R32Matchup[]; }`
  - `projectBracket(gmsByGroup: Record<string, GsMatch[]>, playedCountByGroup: Record<string, number>): GroupProjection` — `gmsByGroup[g]` is the combined real+simulated `GsMatch[]` for group `g`; `playedCountByGroup[g]` is how many of those are real (for the `played` field).
  - `r32Participants(proj: GroupProjection): { a: number | null; b: number | null }[]` — maps each `R32Matchup` to its two participant team ids (null until known).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/sim-bracket.test.ts
import { describe, it, expect } from 'vitest';
import { projectBracket, r32Participants, GROUPS } from './sim-bracket.js';
import type { GsMatch } from './group-standings.js';

// Build a fully-decided group where seeds win in id order: team (g*10+1) tops it.
function group(g: string, base: number): GsMatch[] {
  const t = [base + 1, base + 2, base + 3, base + 4];
  const ms: GsMatch[] = [];
  // round-robin: higher-listed team always wins → deterministic 1>2>3>4
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++)
    ms.push({ homeTeamId: t[i], awayTeamId: t[j], homeScore: 1, awayScore: 0 });
  return ms;
}

describe('projectBracket', () => {
  it('with all 12 groups complete: 12 winners, 12 runners, 8 thirds → 16 R32 matchups fully filled', () => {
    const gmsByGroup: Record<string, GsMatch[]> = {};
    const played: Record<string, number> = {};
    GROUPS.forEach((g, i) => { gmsByGroup[g] = group(g, i * 10); played[g] = 6; });
    const proj = projectBracket(gmsByGroup, played);
    expect(proj.allComplete).toBe(true);
    expect(proj.completeCount).toBe(12);
    expect(proj.thirdsRanked.qualifyingGroups.size).toBe(8);
    expect(proj.r32).toHaveLength(16);
    const parts = r32Participants(proj);
    expect(parts).toHaveLength(16);
    // every slot filled once all groups complete + a valid thirds assignment exists
    expect(parts.every((p) => p.a != null && p.b != null)).toBe(true);
  });

  it('with an incomplete group: that group is not complete and its R32 slots are null', () => {
    const gmsByGroup: Record<string, GsMatch[]> = {};
    const played: Record<string, number> = {};
    GROUPS.forEach((g, i) => { gmsByGroup[g] = group(g, i * 10); played[g] = 6; });
    gmsByGroup['A'] = gmsByGroup['A'].slice(0, 5); played['A'] = 5; // 5/6
    const proj = projectBracket(gmsByGroup, played);
    expect(proj.perGroup['A'].complete).toBe(false);
    expect(proj.allComplete).toBe(false);
    expect(proj.completeCount).toBe(11);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-bracket.test.ts`
Expected: FAIL — `projectBracket` / `r32Participants` / `GROUPS` not exported.

- [ ] **Step 3: Implement in `sim-bracket.ts`**

Add these imports and exports (append after existing code; keep existing exports intact):

```typescript
import { rankGroup, type GsMatch } from './group-standings.js';

export const GROUPS = 'ABCDEFGHIJKL'.split('');

export function statsOf(gms: GsMatch[]): Record<number, { points: number; gf: number; ga: number }> {
  const t: Record<number, { points: number; gf: number; ga: number }> = {};
  const ens = (id: number) => (t[id] ??= { points: 0, gf: 0, ga: 0 });
  for (const m of gms) {
    const h = ens(m.homeTeamId), a = ens(m.awayTeamId);
    h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) h.points += 3;
    else if (m.homeScore < m.awayScore) a.points += 3;
    else { h.points++; a.points++; }
  }
  return t;
}

export interface GroupProjection {
  perGroup: Record<string, { complete: boolean; order: number[] | null; played: number }>;
  thirds: ThirdInfo[];
  thirdsRanked: { ranked: ThirdInfo[]; qualifyingGroups: Set<string> };
  allComplete: boolean;
  completeCount: number;
  r32: R32Matchup[];
}

export function projectBracket(
  gmsByGroup: Record<string, GsMatch[]>,
  playedCountByGroup: Record<string, number>
): GroupProjection {
  const winners: Record<string, number | undefined> = {};
  const runners: Record<string, number | undefined> = {};
  const thirdByGroup: Record<string, number | undefined> = {};
  const perGroup: GroupProjection['perGroup'] = {};
  const thirds: ThirdInfo[] = [];
  let completeCount = 0;
  for (const g of GROUPS) {
    const gms = gmsByGroup[g] ?? [];
    const complete = gms.length === 6;
    perGroup[g] = { complete, order: complete ? rankGroup(gms) : null, played: playedCountByGroup[g] ?? 0 };
    if (complete) {
      completeCount++;
      const order = perGroup[g].order as number[];
      winners[g] = order[0]; runners[g] = order[1]; thirdByGroup[g] = order[2];
      const s = statsOf(gms)[order[2]];
      thirds.push({ group: g, teamId: order[2], points: s.points, gd: s.gf - s.ga, gf: s.gf });
    }
  }
  const allComplete = completeCount === 12;
  const thirdsRanked = rankThirds(thirds);
  const assignment = allComplete ? assignThirds(thirdsRanked.qualifyingGroups) : null;
  const r32 = buildR32({ winners, runners, thirdByGroup, thirdsAssignment: assignment });
  return { perGroup, thirds, thirdsRanked, allComplete, completeCount, r32 };
}

export function r32Participants(proj: GroupProjection): { a: number | null; b: number | null }[] {
  return proj.r32.map((mu) => ({ a: mu.a.teamId, b: mu.b.teamId }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-bracket.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/sim-bracket.ts src/lib/sim-bracket.test.ts
git commit -m "feat(sim): pure projectBracket group→R32 projection"
```

---

### Task 2: Make R32 a pickable round in the tree resolver

Generalize `resolveTree` so R32 participants can be supplied externally (from projected groups) and R32 winners can be chosen — while staying byte-for-byte backward-compatible with the odds enumerator (which passes finished R32 only).

**Files:**
- Modify: `src/lib/knockout-odds.ts` (`resolveTree` signature + R32 handling)
- Test: `src/lib/knockout-odds.test.ts` (create or extend)

**Interfaces:**
- Consumes: existing `OddsMatchIn`, `groupByPhase`, `finishedWinner`, `TreeSlot`, `ResolvedTree` in this file.
- Produces (changed signature — third param is optional, so existing calls are unaffected):
  - `resolveTree(byPhase: Record<Phase, OddsMatchIn[]>, choose: (m: OddsMatchIn, a: number | null, b: number | null) => number | null, r32Participants?: { a: number | null; b: number | null }[]): ResolvedTree`
  - When `r32Participants` is omitted, R32 participants derive from `byPhase.r32[i]`'s own `homeTeamId`/`awayTeamId` (unchanged odds behavior). When provided, `r32Participants[i]` supplies the participants for the (not-yet-finished) R32 tie, and its winner comes from `choose`. A finished DB R32 match always wins via its real result regardless.
  - `pw.r32` now reflects the resolved R32 winners (finished OR chosen).

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/knockout-odds.test.ts
import { describe, it, expect } from 'vitest';
import { groupByPhase, resolveTree, type OddsMatchIn, type Phase } from './knockout-odds.js';

// 16 empty (unfinished, team-less) R32 rows + empty later rounds — the pre-draw shape.
function emptyKo(): OddsMatchIn[] {
  const mk = (phase: Phase, n: number): OddsMatchIn[] =>
    Array.from({ length: n }, (_, i) => ({
      phase, index: i, finished: false,
      homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, penaltyWinnerId: null,
    }));
  return [...mk('r32', 16), ...mk('r16', 8), ...mk('qf', 4), ...mk('sf', 2), ...mk('final', 1), ...mk('3rd', 1)];
}

describe('resolveTree with external R32 participants', () => {
  it('R32 is pickable and a chosen R32 winner appears in pw.r32', () => {
    const byPhase = groupByPhase(emptyKo());
    // participants: slot 0 = 101 vs 102, all others 201.. paired arbitrarily
    const parts = Array.from({ length: 16 }, (_, i) => ({ a: 100 + i * 2, b: 101 + i * 2 }));
    // choose r32 slot 0's winner = 100 (team a); leave everything else undecided
    const tree = resolveTree(byPhase, (m, a, b) => {
      if (m.phase === 'r32' && m.index === 0) return 100; // a
      return null;
    }, parts);
    expect(tree.pw.r32.has(100)).toBe(true);
    // r16 slot 0 waits for BOTH r32[0] and r32[1]; r32[1] undecided → r16[0] undecided
    expect(tree.rounds.r16[0].winner).toBe(null);
  });

  it('omitting r32Participants preserves finished-only behavior (odds path)', () => {
    const ko = emptyKo();
    // finish r32[0]: 10 beats 20
    ko[0] = { ...ko[0], finished: true, homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 1 };
    const byPhase = groupByPhase(ko);
    const tree = resolveTree(byPhase, () => null); // no participants, no choices
    expect(tree.pw.r32.has(10)).toBe(true);
    expect(tree.pw.r32.has(20)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/knockout-odds.test.ts`
Expected: FAIL — first case throws/returns wrong because `resolveTree` ignores a third arg and treats R32 as finished-only (`pw.r32` empty).

- [ ] **Step 3: Implement the generalized R32 seeding**

In `src/lib/knockout-odds.ts`, replace the R32 seeding block inside `resolveTree`. The current code is:

```typescript
  const r32w = (byPhase.r32 ?? []).map(finishedWinner);
  const r16: TreeSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const a = r32w[2 * i] ?? null, b = r32w[2 * i + 1] ?? null;
    r16.push({ a, b, winner: pick(byPhase.r16?.[i], a, b).winner });
  }
```

Change the signature and replace that block with pickable R32:

```typescript
export function resolveTree(
  byPhase: Record<Phase, OddsMatchIn[]>,
  choose: (m: OddsMatchIn, a: number | null, b: number | null) => number | null,
  r32Participants?: { a: number | null; b: number | null }[]
): ResolvedTree {
  const pick = (m: OddsMatchIn | undefined, a: number | null, b: number | null): { winner: number | null; loser: number | null } => {
    if (m && m.finished) { const w = finishedWinner(m); return { winner: w, loser: w === a ? b : a }; }
    if (!m) return { winner: a ?? b, loser: null };
    const w = choose(m, a, b);
    return { winner: w, loser: w == null ? null : (w === a ? b : a) };
  };

  // R32 is the only round whose participants come from OUTSIDE the KO tree (group
  // results). If r32Participants is supplied (unified sim), use it and let R32 be
  // picked; otherwise fall back to each DB r32 row's own teams (odds path: those
  // rows are finished, so pick() returns the real winner and choose is never hit).
  const r32Slots: TreeSlot[] = [];
  const r32w: (number | null)[] = [];
  for (let i = 0; i < 16; i++) {
    const m = byPhase.r32?.[i];
    const ext = r32Participants?.[i];
    const a = m && m.finished ? m.homeTeamId : (ext ? ext.a : (m?.homeTeamId ?? null));
    const b = m && m.finished ? m.awayTeamId : (ext ? ext.b : (m?.awayTeamId ?? null));
    const w = pick(m, a, b).winner;
    r32Slots.push({ a, b, winner: w });
    r32w.push(w);
  }

  const r16: TreeSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const a = r32w[2 * i] ?? null, b = r32w[2 * i + 1] ?? null;
    r16.push({ a, b, winner: pick(byPhase.r16?.[i], a, b).winner });
  }
```

Then update the `pw` object's `r32` entry to use the resolved winners. Find:

```typescript
    r32: S(r32w), r16: S(r16.map((s) => s.winner)), qf: S(qf.map((s) => s.winner)),
```

`r32w` now already holds the resolved (finished-or-chosen) winners, so this line is unchanged — verify it reads `S(r32w)`. Leave the rest of the function (qf/sf/final/third/finalists) exactly as-is.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/knockout-odds.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Guard the odds enumerator against regressions**

Run the full suite to confirm `computeKnockoutOdds` (which calls `resolveTree` with no third arg) is unchanged:

Run: `cd /Users/jsr/world-cup-pool && npm test`
Expected: PASS — all existing knockout/scoring tests still green.

- [ ] **Step 6: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/knockout-odds.ts src/lib/knockout-odds.test.ts
git commit -m "feat(sim): make R32 a pickable round in resolveTree (backward-compatible)"
```

---

### Task 3: Pure unified per-entry projection scorer

One pure function that scores every member's projected total by composing simulated group points + simulated knockout points, with no double-counting, and returns a ranked leaderboard with movement.

**Files:**
- Create: `src/lib/sim-projection.ts`
- Test: `src/lib/sim-projection.test.ts`

**Interfaces:**
- Consumes: `PreppedEntry`, `ResolvedTree`, `scoreEntry` from `src/lib/knockout-odds.ts`.
- Produces:
  - `interface UnifiedEntry { id: number; userId: number; name: string; label: string | null; prepped: PreppedEntry; groupPicks: Record<number, '1' | 'X' | '2'>; groupOrders: Record<string, number[]>; }`
  - `interface ProjCtx { sim: Record<number, '1' | 'X' | '2'>; unplayedByGroup: Record<string, { id: number }[]>; simOrderByGroup: Record<string, number[]>; matchOutcomePts: number; groupPositionPts: number; baseRankById: Record<number, number>; }`
  - `interface UnifiedRow { id: number; userId: number; name: string; label: string | null; base: number; total: number; correct: number; rank: number; move: number; }`
  - `computeUnifiedProjection(entries: UnifiedEntry[], tree: ResolvedTree, koRules: Record<string, number>, ctx: ProjCtx): UnifiedRow[]`
  - The per-entry KO part is `scoreEntry(entry.prepped, tree, koRules)` whose `.pts` already equals `base + simulatedKO` (because `prepped.in.base = total_score − realizedKO`). Group-sim points are added ON TOP, only for undecided group items.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/sim-projection.test.ts
import { describe, it, expect } from 'vitest';
import { computeUnifiedProjection, type UnifiedEntry, type ProjCtx } from './sim-projection.js';
import { prepEntry, groupByPhase, resolveTree, type OddsMatchIn, type Phase } from './knockout-odds.js';

function emptyByPhase() {
  const mk = (phase: Phase, n: number): OddsMatchIn[] =>
    Array.from({ length: n }, (_, i) => ({
      phase, index: i, finished: false,
      homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, penaltyWinnerId: null,
    }));
  return groupByPhase([...mk('r32', 16), ...mk('r16', 8), ...mk('qf', 4), ...mk('sf', 2), ...mk('final', 1), ...mk('3rd', 1)]);
}

function entry(id: number, base: number, groupPicks: Record<number, '1' | 'X' | '2'> = {}): UnifiedEntry {
  return {
    id, userId: id, name: 'U' + id, label: null,
    prepped: prepEntry({ id, userId: id, name: 'U' + id, label: null, base, baseCorrect: 0, picks: [] }),
    groupPicks, groupOrders: {},
  };
}

const baseCtx: ProjCtx = {
  sim: {}, unplayedByGroup: {}, simOrderByGroup: {},
  matchOutcomePts: 1, groupPositionPts: 0, baseRankById: {},
};

describe('computeUnifiedProjection', () => {
  it('zero picks → total equals base, ranked by base desc', () => {
    const tree = resolveTree(emptyByPhase(), () => null, Array(16).fill({ a: null, b: null }));
    const rows = computeUnifiedProjection([entry(1, 10), entry(2, 20)], tree, {}, baseCtx);
    expect(rows.map((r) => [r.id, r.total])).toEqual([[2, 20], [1, 10]]);
    expect(rows.every((r) => r.total === r.base)).toBe(true);
  });

  it('a simulated group 1/X/2 that matches a pick adds match_outcome points', () => {
    const tree = resolveTree(emptyByPhase(), () => null, Array(16).fill({ a: null, b: null }));
    const e = entry(1, 10, { 500: '1' }); // this member picked '1' for match 500
    const ctx: ProjCtx = { ...baseCtx, sim: { 500: '1' }, unplayedByGroup: { A: [{ id: 500 }] } };
    const rows = computeUnifiedProjection([e], tree, {}, ctx);
    expect(rows[0].total).toBe(11); // 10 base + 1 match_outcome
    expect(rows[0].correct).toBe(1);
  });

  it('a simulated group pick that does NOT match adds nothing', () => {
    const tree = resolveTree(emptyByPhase(), () => null, Array(16).fill({ a: null, b: null }));
    const e = entry(1, 10, { 500: '2' }); // member picked '2'
    const ctx: ProjCtx = { ...baseCtx, sim: { 500: '1' }, unplayedByGroup: { A: [{ id: 500 }] } };
    const rows = computeUnifiedProjection([e], tree, {}, ctx);
    expect(rows[0].total).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-projection.test.ts`
Expected: FAIL — module `sim-projection.ts` does not exist.

- [ ] **Step 3: Implement `sim-projection.ts`**

```typescript
// Pure unified projection: compose simulated GROUP points and simulated KNOCKOUT
// points into one ranked leaderboard, with no double-counting. Framework-free.
import { scoreEntry, type PreppedEntry, type ResolvedTree } from './knockout-odds.js';

export interface UnifiedEntry {
  id: number;
  userId: number;
  name: string;
  label: string | null;
  prepped: PreppedEntry;                         // prepEntry(bracketEntry) — prepped.in.base = total_score − realizedKO
  groupPicks: Record<number, '1' | 'X' | '2'>;   // this member's group pick per matchId
  groupOrders: Record<string, number[]>;         // this member's predicted [p1,p2,p3,p4] per group
}

export interface ProjCtx {
  sim: Record<number, '1' | 'X' | '2'>;          // simulated group results (matchId → code)
  unplayedByGroup: Record<string, { id: number }[]>; // undecided group matches per group
  simOrderByGroup: Record<string, number[]>;     // groups the sim FULLY completes → resulting order
  matchOutcomePts: number;
  groupPositionPts: number;
  baseRankById: Record<number, number>;          // live dense rank per entry id (for movement)
}

export interface UnifiedRow {
  id: number; userId: number; name: string; label: string | null;
  base: number; total: number; correct: number; rank: number; move: number;
}

/** Points/correct a member earns from the SIMULATED (undecided) group items only.
 *  Finished group matches are already baked into total_score (→ prepped.in.base). */
function groupSim(e: UnifiedEntry, ctx: ProjCtx): { pts: number; correct: number } {
  let pts = 0, correct = 0;
  for (const g of Object.keys(ctx.unplayedByGroup)) {
    for (const m of ctx.unplayedByGroup[g]) {
      const code = ctx.sim[m.id];
      if (code && e.groupPicks[m.id] === code) { pts += ctx.matchOutcomePts; correct++; }
    }
  }
  if (ctx.groupPositionPts > 0) {
    for (const g of Object.keys(ctx.simOrderByGroup)) {
      const order = ctx.simOrderByGroup[g], pred = e.groupOrders[g];
      if (!pred) continue;
      for (let i = 0; i < 4; i++) if (pred[i] && order[i] === pred[i]) { pts += ctx.groupPositionPts; correct++; }
    }
  }
  return { pts, correct };
}

export function computeUnifiedProjection(
  entries: UnifiedEntry[],
  tree: ResolvedTree,
  koRules: Record<string, number>,
  ctx: ProjCtx
): UnifiedRow[] {
  const rows = entries.map((e) => {
    const ko = scoreEntry(e.prepped, tree, koRules);   // = base + simulated KO
    const gs = groupSim(e, ctx);
    return {
      id: e.id, userId: e.userId, name: e.name, label: e.label,
      base: e.prepped.in.base,
      total: ko.pts + gs.pts,
      correct: ko.correct + gs.correct,
    };
  });
  rows.sort((a, b) => b.total - a.total || b.correct - a.correct || b.base - a.base);
  let r = 0, prevT: number | null = null, prevC: number | null = null;
  return rows.map((row, i) => {
    if (i === 0 || row.total !== prevT || row.correct !== prevC) { r = i + 1; prevT = row.total; prevC = row.correct; }
    return { ...row, rank: r, move: (ctx.baseRankById[row.id] ?? r) - r };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-projection.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/sim-projection.ts src/lib/sim-projection.test.ts
git commit -m "feat(sim): pure unified group+knockout projection scorer"
```

---

### Task 4: Cascade regression tests (the known bug class)

Lock down the 3rd-place / stale-pick behavior across the group→KO seam before any UI depends on it.

**Files:**
- Test: `src/lib/knockout-odds.test.ts` (extend)

**Interfaces:**
- Consumes: `groupByPhase`, `resolveTree`, `prepEntry`, `scoreEntry` from Task 2.

- [ ] **Step 1: Write the regression tests**

Add to `src/lib/knockout-odds.test.ts`:

```typescript
describe('cascade regression: stale picks & 3rd place', () => {
  function ko(): OddsMatchIn[] {
    const mk = (phase: Phase, n: number): OddsMatchIn[] =>
      Array.from({ length: n }, (_, i) => ({
        phase, index: i, finished: false,
        homeTeamId: null, awayTeamId: null, homeScore: null, awayScore: null, penaltyWinnerId: null,
      }));
    return [...mk('r32', 16), ...mk('r16', 8), ...mk('qf', 4), ...mk('sf', 2), ...mk('final', 1), ...mk('3rd', 1)];
  }

  it('changing an R32 winner invalidates a downstream R16 pick for the team that no longer arrives', () => {
    const byPhase = groupByPhase(ko());
    const parts = Array.from({ length: 16 }, (_, i) => ({ a: 100 + i * 2, b: 101 + i * 2 }));
    // choose r32[0]=100, r32[1]=102 → r16[0] is 100 vs 102; pick r16[0]=100
    const choiceA: Record<string, number> = { 'r32:0': 100, 'r32:1': 102, 'r16:0': 100 };
    const chooseFrom = (c: Record<string, number>) => (m: OddsMatchIn, a: number | null, b: number | null) => {
      const w = c[m.phase + ':' + m.index];
      return w === a || w === b ? w : null; // honour pick only while its team participates
    };
    let tree = resolveTree(byPhase, chooseFrom(choiceA), parts);
    expect(tree.rounds.r16[0].winner).toBe(100);

    // now r32[0] winner changes to 101 → 100 never reaches r16[0]; the r16:0=100 pick is stale
    const choiceB: Record<string, number> = { 'r32:0': 101, 'r32:1': 102, 'r16:0': 100 };
    tree = resolveTree(byPhase, chooseFrom(choiceB), parts);
    expect(tree.rounds.r16[0].a).toBe(101);
    expect(tree.rounds.r16[0].winner).toBe(null); // stale 100 pick no longer honoured
  });

  it('third-place winner scores third_place; a finalist scores knockout_final only once final decided', () => {
    const byPhase = groupByPhase(ko());
    const parts = Array.from({ length: 16 }, (_, i) => ({ a: 100 + i, b: 200 + i }));
    // Drive one full wing to a final + 3rd. Choose team a at every step of the left half.
    const choice: Record<string, number> = {};
    for (let i = 0; i < 16; i++) choice['r32:' + i] = parts[i].a;
    for (let i = 0; i < 8; i++) choice['r16:' + i] = parts[2 * i].a;
    for (let i = 0; i < 4; i++) choice['qf:' + i] = parts[4 * i].a;
    for (let i = 0; i < 2; i++) choice['sf:' + i] = parts[8 * i].a;
    const choose = (m: OddsMatchIn, a: number | null, b: number | null) => {
      const w = choice[m.phase + ':' + m.index];
      return w === a || w === b ? w : null;
    };
    // final & 3rd NOT chosen yet
    let tree = resolveTree(byPhase, choose, parts);
    expect(tree.rounds.final.a).not.toBe(null);
    expect(tree.rounds.final.b).not.toBe(null);
    expect(tree.finalists.size).toBe(0); // final undecided → no consolation credited
    const finalA = tree.rounds.final.a as number, finalB = tree.rounds.final.b as number;

    // pick the final and the 3rd-place match
    choice['final:0'] = finalA;
    const sfLoserA = tree.rounds.third.a as number;
    choice['3rd:0'] = sfLoserA;
    tree = resolveTree(byPhase, choose, parts);
    expect(tree.finalists.has(finalA)).toBe(true);
    expect(tree.finalists.has(finalB)).toBe(true);
    expect(tree.rounds.third.winner).toBe(sfLoserA);

    // scoring: an entry that picked finalB as champion earns knockout_final (finalist) but not knockout_winner
    const rules = { knockout_final: 5, knockout_winner: 10, third_place: 3 };
    const loserPick = prepEntry({ id: 1, userId: 1, name: 'x', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 0, teamId: finalB }] });
    expect(scoreEntry(loserPick, tree, rules).pts).toBe(5);
    const thirdPick = prepEntry({ id: 2, userId: 2, name: 'y', label: null, base: 0, baseCorrect: 0, picks: [{ phase: '3rd', slot: 0, teamId: sfLoserA }] });
    expect(scoreEntry(thirdPick, tree, rules).pts).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify they pass**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/knockout-odds.test.ts`
Expected: PASS. If any fail, the resolver (Task 2) has a cascade bug — fix there before proceeding.

- [ ] **Step 3: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/knockout-odds.test.ts
git commit -m "test(sim): cascade stale-pick + 3rd-place regression coverage"
```

---

### Task 5: Ungate the server payload

Ship the knockout template + everyone's bracket picks whenever bets are locked (not only once R32 is finished), so the client can cascade from the group stage. Keep the expensive odds enumeration gated.

**Files:**
- Modify: `src/lib/server/simulator-data.ts`

**Interfaces:**
- Consumes: existing queries in the file.
- Produces: payload where `koMatches`, `bracketEntries`, `knockoutRules` are populated whenever `betsLocked` (regardless of `r32AllDone`); `odds`/`oddsMeta` stay populated only when `r32AllDone`.

- [ ] **Step 1: Restructure the gate**

In `src/lib/server/simulator-data.ts`, the block currently reads (abridged): everything KO-related lives inside `if (r32AllDone) { … }`. Split it so only the odds enumeration stays gated. Replace the `if (r32AllDone) { … }` body region with this structure — build `koMatches`, `koPtsByPred`, `groupCorrectByPred`, `picksByPred`, `oddsEntries` UNCONDITIONALLY (once `betsLocked`), then compute `odds` only when `r32AllDone`:

```typescript
  // KO template rows (r32..final). Pre-draw these have null teams — fine, the
  // client builds R32 participants from the projected group tables.
  const idxByPhase: Record<string, number> = {};
  const koMatches: OddsMatchIn[] = koRows.map((m: any) => {
    const i = (idxByPhase[m.phase] = (idxByPhase[m.phase] ?? -1) + 1);
    return {
      phase: m.phase as Phase, index: i,
      finished: m.status === 'finished' && m.home_score != null && m.away_score != null,
      homeTeamId: m.home_team_id, awayTeamId: m.away_team_id,
      homeScore: m.home_score, awayScore: m.away_score, penaltyWinnerId: m.penalty_winner_id ?? null,
    };
  });

  const { rows: koPtsRows } = await query(
    `SELECT bp.prediction_id AS pid, COALESCE(SUM(bp.points_earned), 0) AS pts
     FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
     WHERE p.pool_id = $1 GROUP BY bp.prediction_id`, [poolId]
  );
  const koPtsByPred: Record<number, number> = {};
  for (const r of koPtsRows) koPtsByPred[r.pid] = Number(r.pts) || 0;

  const { rows: gcRows } = await query(
    `SELECT mp.prediction_id AS pid, COUNT(*) FILTER (WHERE mp.points_earned > 0) AS cnt
     FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id
     WHERE p.pool_id = $1 GROUP BY mp.prediction_id`, [poolId]
  );
  const groupCorrectByPred: Record<number, number> = {};
  for (const r of gcRows) groupCorrectByPred[r.pid] = Number(r.cnt) || 0;

  const { rows: bpRows } = await query(
    `SELECT bp.prediction_id AS pid, bp.phase, bp.slot, bp.team_id
     FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
     WHERE p.pool_id = $1`, [poolId]
  );
  const picksByPred: Record<number, { phase: string; slot: number; teamId: number | null }[]> = {};
  for (const r of bpRows) (picksByPred[r.pid] ??= []).push({ phase: r.phase, slot: Number(r.slot), teamId: r.team_id });

  const oddsEntries: OddsEntryIn[] = entries.map((e) => ({
    id: e.id, userId: e.user_id, name: e.display_name, label: e.label,
    base: e.total_score - (koPtsByPred[e.id] ?? 0),
    baseCorrect: groupCorrectByPred[e.id] ?? 0,
    picks: picksByPred[e.id] ?? [],
  }));

  koMatchesOut = koMatches;
  bracketEntries = oddsEntries;

  // Odds enumeration is the expensive part and only meaningful once R32 is done.
  const r32Rows = koRows.filter((m: any) => m.phase === 'r32');
  const r32AllDone = r32Rows.length > 0 && r32Rows.every((m: any) => m.status === 'finished' && m.home_score != null);
  if (r32AllDone) {
    const result = computeKnockoutOdds(koMatches, oddsEntries, scoring);
    odds = result.rows;
    oddsMeta = { scenarios: result.scenarios, remaining: result.remaining, exact: result.exact };
  }
```

Ensure the earlier `let koMatchesOut`, `let bracketEntries`, `let odds`, `let oddsMeta`, and the `knockoutRules` object stay declared above this block (they already are), and that `koRows` is still fetched above (it is). Remove the now-duplicated declarations that were inside the old `if (r32AllDone)` block.

- [ ] **Step 2: Typecheck**

Run: `cd /Users/jsr/world-cup-pool && npm run check`
Expected: no new type errors in `simulator-data.ts`.

- [ ] **Step 3: Manual read-only sanity check (scratch DB only)**

If a scratch DB with a locked pool that has NOT started the knockout stage is available, hit `/api/pools/<id>/simulator` and confirm the JSON now contains a non-empty `koMatches` array and `bracketEntries` while `odds` is `[]`. Do NOT run this against prod. If no scratch DB is available, note it and rely on Task 7's end-to-end run.

- [ ] **Step 4: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/server/simulator-data.ts
git commit -m "feat(sim): ship KO template + bracket picks whenever bets locked"
```

---

### Task 6: Rewrite Simulador UI — two tabs, two-column, combined Pendientes, unified leaderboard

Collapse the three sub-views into **Simulador** (fused) + **🔮 Probabilidades** (unchanged). Left column = one ordered "Pendientes" list (group `1/X/2`, then R32→Final ties revealed progressively). Right column = the unified projected leaderboard. Single column on narrow screens.

**Files:**
- Modify: `src/lib/Simulator.svelte`

**Interfaces:**
- Consumes: `projectBracket`, `r32Participants`, `GROUPS` (Task 1); `groupByPhase`, `resolveTree`, `prepEntry`, `type OddsMatchIn`, `type Phase` (Task 2); `computeUnifiedProjection`, `type UnifiedEntry`, `type ProjCtx` (Task 3); `rankGroup`, `type GsMatch` (existing); `flagEmoji`, `shortName` (existing).
- Data props unchanged; now `data.koMatches` / `data.bracketEntries` arrive pre-R32 too.

- [ ] **Step 1: Replace the sub-view state and build the unified deriveds**

In the `<script>` of `src/lib/Simulator.svelte`, replace the three-way `view`/`koView` state and the separate `projection`/`bracket`/`koProjection` deriveds with one unified model. Keep the existing helpers (`isFinished`, `played`, `unplayed`, `realByGroup`, `unplayedByGroup`, `canon`, `baseRankById`, `unplayedByDate`, `tName`, `tFlag`, `myIds`, `myPrimaryId`, `myPick`) and the odds-tab code. Add:

```typescript
  import { projectBracket, r32Participants, GROUPS } from '$lib/sim-bracket.js';
  import { groupByPhase, resolveTree, prepEntry, type OddsMatchIn, type Phase } from '$lib/knockout-odds.js';
  import { computeUnifiedProjection, type UnifiedEntry, type ProjCtx } from '$lib/sim-projection.js';

  // Two tabs now: the fused simulator, and the (unchanged) odds tab.
  let tab = $state<'sim' | 'odds'>('sim');

  // group sim (matchId → 1/X/2) and knockout choices (phase:index → teamId)
  let sim = $state<Record<number, '1' | 'X' | '2'>>({});
  let koChoice = $state<Record<string, number>>({});
  const koKey = (phase: string, index: number) => phase + ':' + index;

  // combined real+sim GsMatch per group (for projectBracket)
  const gmsByGroup = $derived.by(() => {
    const out: Record<string, GsMatch[]> = {};
    const played: Record<string, number> = {};
    for (const g of GROUPS) {
      const real = realByGroup[g] || [];
      out[g] = [...real];
      played[g] = real.length;
      for (const m of (unplayedByGroup[g] || [])) {
        if (sim[m.id]) { const [hs, as] = canon(sim[m.id]); out[g].push({ homeTeamId: m.home_team_id, awayTeamId: m.away_team_id, homeScore: hs, awayScore: as }); }
      }
    }
    return { out, played };
  });
  const proj = $derived(projectBracket(gmsByGroup.out, gmsByGroup.played));
  const r32parts = $derived(r32Participants(proj));

  // knockout tree cascaded from projected R32 participants + user choices
  const koMatches = $derived((data.koMatches as OddsMatchIn[]) ?? []);
  const koByPhase = $derived(groupByPhase(koMatches));
  const koRules = $derived((data.knockoutRules as Record<string, number>) ?? {});
  const koTree = $derived(resolveTree(koByPhase, (m, a, b) => {
    const w = koChoice[koKey(m.phase, m.index)];
    return w === a || w === b ? w : null;
  }, r32parts));

  // groups the sim FULLY completes → their resulting order (for group_position pts)
  const simOrderByGroup = $derived.by(() => {
    const out: Record<string, number[]> = {};
    if (data.groupPositionPts > 0) {
      for (const g of GROUPS) {
        const pg = proj.perGroup[g];
        if (pg.complete && pg.order && (unplayedByGroup[g] || []).some((m) => sim[m.id])) out[g] = pg.order;
      }
    }
    return out;
  });

  // prepped unified entries (bracket picks + this member's group picks/orders)
  const unifiedEntries = $derived.by((): UnifiedEntry[] => {
    const bes = (data.bracketEntries as any[]) ?? [];
    return bes.map((be) => ({
      id: be.id, userId: be.userId, name: be.name, label: be.label,
      prepped: prepEntry(be),
      groupPicks: (data.picks[be.id] as Record<number, '1' | 'X' | '2'>) ?? {},
      groupOrders: (data.orders[be.id] as Record<string, number[]>) ?? {},
    }));
  });

  const projCtx = $derived<ProjCtx>({
    sim, unplayedByGroup, simOrderByGroup,
    matchOutcomePts: data.matchOutcomePts, groupPositionPts: data.groupPositionPts,
    baseRankById,
  });
  const leaderboard = $derived(computeUnifiedProjection(unifiedEntries, koTree, koRules, projCtx));

  const decidedCount = $derived(Object.keys(sim).length + Object.keys(koChoice).length);
  function setPick(mid: number, code: '1' | 'X' | '2') {
    if (sim[mid] === code) { const { [mid]: _d, ...rest } = sim; sim = rest; } else sim = { ...sim, [mid]: code };
  }
  function setKoWinner(phase: string, index: number, teamId: number | null) {
    if (teamId == null) return;
    const k = koKey(phase, index);
    if (koChoice[k] === teamId) { const { [k]: _d, ...rest } = koChoice; koChoice = rest; } else koChoice = { ...koChoice, [k]: teamId };
  }
  function resetAll() { sim = {}; koChoice = {}; }
```

**Build note (fallback when `bracketEntries` is empty):** if the server has not shipped `bracketEntries` yet (e.g. bets not locked), `unifiedEntries` is `[]` and `leaderboard` is `[]` — the template's `{#if !data.betsLocked}` lock screen already covers that case, so no extra guard is needed.

- [ ] **Step 2: Build the combined "Pendientes" list and the two-column markup**

Replace the three-view template body (everything between the `{:else}` after the lock screen and the closing of the bets-locked branch, EXCEPT the odds tab which you keep) with: a two-tab toggle (`sim` / `odds`), then for `tab === 'sim'` a two-column grid. Use this structure (styling follows the file's existing inline-style idiom; the `.sim-grid`/`.sim-col` classes come from the `<style>` block in Step 3):

```svelte
{#if koMatches.length > 0}
  <div style="display:flex; gap:6px; margin:6px 0 14px;">
    <button onclick={() => (tab = 'sim')} style="flex:1; font-size:10px; font-weight:600; padding:7px; border-radius:7px; cursor:pointer; border:1px solid {tab==='sim'?'var(--gold)':'var(--border)'}; background:{tab==='sim'?'rgba(201,168,76,0.12)':'var(--bg-card)'}; color:{tab==='sim'?'var(--gold)':'var(--text-muted)'};">🎯 Simulador</button>
    <button onclick={() => (tab = 'odds')} style="flex:1; font-size:10px; font-weight:600; padding:7px; border-radius:7px; cursor:pointer; border:1px solid {tab==='odds'?'var(--gold)':'var(--border)'}; background:{tab==='odds'?'rgba(201,168,76,0.12)':'var(--bg-card)'}; color:{tab==='odds'?'var(--gold)':'var(--text-muted)'};">🔮 Probabilidades</button>
  </div>
{/if}

{#if tab === 'odds'}
  <!-- KEEP the existing 🔮 odds markup verbatim (the `{#if koView === 'odds' …}` block content) -->
{:else}
  <div class="sim-grid">
    <!-- LEFT: Pendientes -->
    <div class="sim-col">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
        <h2 style="font-size:12px; font-weight:700; color:var(--text); margin:0;">Pendientes</h2>
        <span style="font-size:9px; color:var(--text-dim);">{decidedCount} decidido{decidedCount===1?'':'s'}{#if decidedCount>0} · <button onclick={resetAll} style="background:none; border:none; color:var(--gold); font-size:9px; cursor:pointer; padding:0; text-decoration:underline;">limpiar</button>{/if}</span>
      </div>
      <!-- (a) pending GROUP matches by date: reuse the existing `unplayedByDate` 1/X/2 control markup -->
      <!-- (b) then the KO rounds, each revealed progressively via the koMatch snippet below -->
    </div>
    <!-- RIGHT: projected leaderboard -->
    <div class="sim-col">
      <h2 style="font-size:12px; font-weight:700; color:var(--text); margin:0 0 6px;">Clasificación proyectada</h2>
      <div style="display:flex; flex-direction:column; gap:3px;">
        {#each visibleLeaderboard as e (e.id)}
          {@const mine = myIds.has(e.id)}
          <div style="display:flex; align-items:center; gap:8px; padding:6px 9px; border-radius:6px; background:{mine?'rgba(201,168,76,0.1)':'var(--bg-card)'}; border:1px solid {mine?'var(--gold)':'var(--border)'};">
            <span style="width:18px; font-size:11px; font-weight:700; color:{e.rank===1?'var(--gold)':'var(--text-muted)'};">{e.rank}</span>
            {#if e.move!==0}<span style="font-size:9px; font-weight:700; color:{e.move>0?'var(--green)':'var(--red)'};">{e.move>0?'▲':'▼'}{Math.abs(e.move)}</span>{:else}<span style="width:12px;"></span>{/if}
            <span style="flex:1; min-width:0; font-size:11px; font-weight:{mine?'700':'500'}; color:{mine?'var(--gold)':'var(--text)'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{e.name}{#if data.pool.allow_multiple_predictions && e.label} · {e.label}{:else if e.label} ({e.label}){/if}</span>
            <span style="flex-shrink:0; text-align:right;">
              <span style="font-size:13px; font-weight:700; color:var(--gold);">{e.total}</span>
              {#if e.total!==e.base}<span style="font-size:9px; color:{e.total>e.base?'var(--green)':'var(--red)'}; margin-left:3px;">{e.total>e.base?'+':''}{e.total-e.base}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
```

Reuse the existing `koMatch` snippet (from the current file) for the KO rounds, and render only rounds/ties whose participants are known (progressive reveal) — a tie with `slot.a == null && slot.b == null` is hidden:

```svelte
{#snippet koRound(label: string, phase: Phase, slots: any[])}
  {@const live = slots.filter((s) => s.a != null || s.b != null)}
  {#if live.length > 0}
    <div style="font-size:9px; color:var(--gold); text-transform:uppercase; letter-spacing:0.08em; margin:12px 0 5px;">{label}</div>
    {#each slots as slot, i}
      {#if slot.a != null || slot.b != null}{@render koMatch(phase, i, slot)}{/if}
    {/each}
  {/if}
{/snippet}
```

Then in the left column, after the group matches, render every KO round from `koTree.rounds` (see the R32 rendering detail below):

```svelte
{@render koRound('Dieciseisavos', 'r32', koTree.rounds.r32)}
{@render koRound('Octavos', 'r16', koTree.rounds.r16)}
{@render koRound('Cuartos', 'qf', koTree.rounds.qf)}
{@render koRound('Semifinales', 'sf', koTree.rounds.sf)}
{@render koRound('Final', 'final', [koTree.rounds.final])}
{@render koRound('3.er puesto', '3rd', [koTree.rounds.third])}
```

**R32 rendering detail:** `koTree.rounds.r32` (added in Task 2's fix) is a `TreeSlot[]` of the 16 resolved R32 ties — participants from the projected groups, winner from a finished DB result or the user's `choose`. Render it as its own round with `koRound('Dieciseisavos','r32',koTree.rounds.r32)` (the `koRound` snippet hides ties whose participants are both null → progressive reveal). Then `koRound('Octavos','r16',koTree.rounds.r16)`, `('Cuartos','qf',…)`, `('Semifinales','sf',…)`, and Final / `3.er puesto` as single-tie rounds (as the current file does). Do NOT hand-roll R32 slots from `r32parts`/`koChoice` — read them from `koTree.rounds.r32`. Disable a `koMatch` button when its DB match is `finished`.

- [ ] **Step 3: Add the scoped `<style>` block for responsive columns**

At the end of `Simulator.svelte`, add (the file has no `<style>` today):

```svelte
<style>
  .sim-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; align-items: start; }
  .sim-col { min-width: 0; }
  @media (max-width: 720px) {
    .sim-grid { grid-template-columns: 1fr; gap: 10px; }
  }
</style>
```

Also change the outer wrapper `max-width` from `560px` to `900px` so two columns have room (keep `margin: 0 auto`).

- [ ] **Step 4: Add a temporary `visibleLeaderboard` alias**

Until Task 7 adds the "Solo cambios" filter, define `const visibleLeaderboard = $derived(leaderboard);` so the template in Step 2 compiles.

- [ ] **Step 5: Typecheck**

Run: `cd /Users/jsr/world-cup-pool && npm run check`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/Simulator.svelte
git commit -m "feat(sim): fuse group+knockout into one two-column progressive-reveal view"
```

---

### Task 7: Extras — Solo cambios, mobile impact bar, Pronóstico de {member}

**Files:**
- Modify: `src/lib/Simulator.svelte`
- Create: `src/lib/sim-forecast.ts`
- Test: `src/lib/sim-forecast.test.ts`

**Interfaces:**
- Consumes: `resolveTree`, `groupByPhase`, `type OddsMatchIn` (Task 2); `proj`/`r32parts` deriveds (Task 6).
- Produces:
  - `buildForecastSim(member: { groupPicks: Record<number, '1'|'X'|'2'>; bracketPicks: { phase: string; slot: number; teamId: number | null }[] }, ctx: { unplayedGroupMatchIds: number[] }): { sim: Record<number, '1'|'X'|'2'> }` — fills pending group matches from the member's group picks. (KO fill happens in the component via fixpoint, below.)

- [ ] **Step 1: Solo cambios filter**

In `Simulator.svelte`, replace the temporary alias from Task 6 Step 4:

```typescript
  let onlyChanges = $state(false);
  const visibleLeaderboard = $derived(onlyChanges ? leaderboard.filter((e) => e.move !== 0 || e.total !== e.base) : leaderboard);
```

Add a toggle next to the "Clasificación proyectada" heading:

```svelte
<button onclick={() => (onlyChanges = !onlyChanges)} style="background:none; border:1px solid {onlyChanges?'var(--gold)':'var(--border)'}; color:{onlyChanges?'var(--gold)':'var(--text-muted)'}; font-size:9px; border-radius:5px; padding:2px 6px; cursor:pointer;">Solo cambios</button>
```

- [ ] **Step 2: Mobile impact bar**

Add a derived for the current user's row and a fixed bar shown only on narrow screens:

```typescript
  const myRow = $derived(myPrimaryId != null ? leaderboard.find((e) => e.id === myPrimaryId) : null);
```

```svelte
{#if myRow && decidedCount > 0}
  <div class="impact-bar">
    <span>Vas <strong style="color:var(--gold);">{myRow.rank}.º</strong></span>
    <span style="color:{myRow.move>0?'var(--green)':myRow.move<0?'var(--red)':'var(--text-muted)'};">{myRow.move>0?`▲ subes ${myRow.move}`:myRow.move<0?`▼ bajas ${Math.abs(myRow.move)}`:'sin cambios'}</span>
    <span style="color:var(--gold); font-weight:700;">{myRow.total}{#if myRow.total!==myRow.base} ({myRow.total>myRow.base?'+':''}{myRow.total-myRow.base}){/if}</span>
  </div>
{/if}
```

Extend the `<style>` block:

```css
  .impact-bar { display: none; }
  @media (max-width: 720px) {
    .impact-bar { display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; gap: 12px; justify-content: space-around; align-items: center; padding: 8px 12px; font-size: 11px; background: var(--bg-card); border-top: 1px solid var(--gold); }
  }
```

- [ ] **Step 3: Write the failing forecast test**

```typescript
// src/lib/sim-forecast.test.ts
import { describe, it, expect } from 'vitest';
import { buildForecastSim } from './sim-forecast.js';

describe('buildForecastSim', () => {
  it('fills only the pending group matches from the member’s group picks', () => {
    const member = {
      groupPicks: { 10: '1' as const, 11: 'X' as const, 12: '2' as const },
      bracketPicks: [],
    };
    const { sim } = buildForecastSim(member, { unplayedGroupMatchIds: [10, 12] }); // 11 already played
    expect(sim).toEqual({ 10: '1', 12: '2' });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-forecast.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 5: Implement `sim-forecast.ts`**

```typescript
// Build a group-stage sim from a member's own predictions (their "forecast").
export interface ForecastMember {
  groupPicks: Record<number, '1' | 'X' | '2'>;
  bracketPicks: { phase: string; slot: number; teamId: number | null }[];
}

export function buildForecastSim(
  member: ForecastMember,
  ctx: { unplayedGroupMatchIds: number[] }
): { sim: Record<number, '1' | 'X' | '2'> } {
  const sim: Record<number, '1' | 'X' | '2'> = {};
  for (const mid of ctx.unplayedGroupMatchIds) {
    const p = member.groupPicks[mid];
    if (p) sim[mid] = p;
  }
  return { sim };
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd /Users/jsr/world-cup-pool && npx vitest run src/lib/sim-forecast.test.ts`
Expected: PASS.

- [ ] **Step 7: Wire "Pronóstico de {member}" into the component**

Add member selection + a KO fixpoint fill (KO ties unlock only as rounds resolve, so iterate). The member's bracket picks are `data.bracketEntries[i].picks` (`{phase,slot,teamId}`), where for a given phase the pick's team is the winner they chose; map to `koChoice['<phase>:<index>']`. Because bracket `slot` is not the same as tree `index`, resolve by matching the picked team to whichever current tie has it as a participant — the same "honour a pick only while its team participates" rule used by `koTree`.

```typescript
  import { buildForecastSim } from '$lib/sim-forecast.js';

  let forecastId = $state<number | null>(null);
  function applyForecast(predId: number | null) {
    forecastId = predId;
    if (predId == null) { resetAll(); return; }
    const be = ((data.bracketEntries as any[]) ?? []).find((e) => e.id === predId);
    if (!be) return;
    // 1) group stage from their 1/X/2
    const unplayedGroupMatchIds = unplayed.filter((m: any) => m.group_name).map((m: any) => m.id);
    sim = buildForecastSim({ groupPicks: data.picks[predId] ?? {}, bracketPicks: be.picks }, { unplayedGroupMatchIds }).sim;
    // 2) KO stage: iterate to a fixpoint, filling each newly-revealed tie with the
    //    member's picked team for that phase (bounded passes = KO depth).
    const wantByPhaseTeam = new Set(be.picks.filter((p: any) => p.teamId != null).map((p: any) => p.phase + ':' + p.teamId));
    let next: Record<string, number> = {};
    for (let pass = 0; pass < 6; pass++) {
      const tree = resolveTree(koByPhase, (m, a, b) => {
        const w = next[koKey(m.phase, m.index)];
        return w === a || w === b ? w : null;
      }, r32parts);
      const rounds: [Phase, any[]][] = [
        ['r32', r32parts.map((p, i) => ({ a: p.a, b: p.b, index: i }))],
        ['r16', tree.rounds.r16], ['qf', tree.rounds.qf], ['sf', tree.rounds.sf],
        ['final', [tree.rounds.final]], ['3rd', [tree.rounds.third]],
      ];
      const before = JSON.stringify(next);
      for (const [phase, slots] of rounds) {
        slots.forEach((s: any, i: number) => {
          const k = koKey(phase, i);
          if (next[k] != null) return;
          for (const cand of [s.a, s.b]) {
            if (cand != null && wantByPhaseTeam.has(phase + ':' + cand)) { next[k] = cand; break; }
          }
        });
      }
      if (JSON.stringify(next) === before) break;
    }
    koChoice = next;
  }
```

Add the picker UI (a `<select>` of `data.bracketEntries`, plus a "nadie" option that calls `applyForecast(null)`), placed above the Pendientes list:

```svelte
<select onchange={(e) => applyForecast(e.currentTarget.value ? Number(e.currentTarget.value) : null)} style="width:100%; font-size:11px; padding:6px 8px; border-radius:6px; background:var(--bg-card); border:1px solid var(--border); color:var(--text); margin-bottom:10px;">
  <option value="">Pronóstico de… (elige un participante)</option>
  {#each (data.bracketEntries as any[]) ?? [] as be}
    <option value={be.id} selected={forecastId === be.id}>{be.name}{be.label ? ' · ' + be.label : ''}</option>
  {/each}
</select>
```

- [ ] **Step 8: Typecheck + full test suite**

Run: `cd /Users/jsr/world-cup-pool && npm run check && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 9: Commit**

```bash
cd /Users/jsr/world-cup-pool
git add src/lib/Simulator.svelte src/lib/sim-forecast.ts src/lib/sim-forecast.test.ts
git commit -m "feat(sim): Solo-cambios filter, mobile impact bar, Pronóstico de {member}"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run: `cd /Users/jsr/world-cup-pool && npm run check && npm test && npm run build`
Expected: all pass, production build succeeds.

- [ ] **Step 2: Drive the app on a scratch DB (never prod)**

Point `DATABASE_URL` at a scratch DB whose host is NOT `neon.tech`, with a locked pool. `npm run dev`, open the pool's 🎲 Simulador tab, and confirm:
- The **Simulador** tab shows a two-column layout (single column on a narrow window).
- Picking a pending **group** `1/X/2` re-ranks the right-column leaderboard and, once a group completes, reveals its **R32** ties.
- Picking a **knockout** winner cascades and reveals the next round; changing an upstream pick clears a now-impossible downstream pick.
- **Solo cambios** filters to moved entries; the **impact bar** appears on a narrow window; **Pronóstico de {member}** fills that member's group + bracket picks.
- The **🔮 Probabilidades** tab is unchanged (only appears once R32 is finished).

- [ ] **Step 3: Invoke the finishing skill**

Use `superpowers:finishing-a-development-branch` to decide merge/PR/cleanup for `feat/simulador-unified-cascade`.

---

## Self-Review

**Spec coverage:**
- Two-column layout → Task 6 (grid + `<style>`). ✓
- Progressive reveal → Task 2 (null-participant stops propagation) + Task 6 (`koRound` hides null ties). ✓
- Merge group + KO → Task 6 (one Pendientes list, group + R32→Final). ✓
- Unified leaderboard / no double-count → Task 3 (`computeUnifiedProjection`, `base = total_score − realizedKO`). ✓
- Solo cambios / impact bar / Pronóstico de {member} → Task 7. ✓
- Drop € deltas → not implemented anywhere (correct). ✓
- Server ungate → Task 5. ✓
- Odds tab unchanged + gated → Task 5 (odds stays behind `r32AllDone`) + Task 6 (verbatim reuse). ✓
- Regression tests (3rd-place/stale-pick) → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows code. Task 6 reuses the existing `koMatch` snippet and odds markup by reference to the current file rather than reproducing ~200 lines of inline styling verbatim — acceptable because those blocks are unchanged and present in the working tree.

**Type consistency:** `projectBracket`/`r32Participants` (Task 1) → consumed in Task 6. `resolveTree(byPhase, choose, r32Participants?)` (Task 2) → used in Tasks 3-test, 4, 6, 7. `computeUnifiedProjection`/`UnifiedEntry`/`ProjCtx` (Task 3) → used in Task 6. `buildForecastSim`/`ForecastMember` (Task 7). `OddsEntryIn`/`Phase` imports in Task 5 already present in `simulator-data.ts`. Names consistent across tasks.
