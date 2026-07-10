import { describe, it, expect } from 'vitest';
import {
  computeKnockoutOdds, groupByPhase, resolveTree, prepEntry, scoreEntry,
  type OddsMatchIn, type OddsEntryIn, type Phase,
} from './knockout-odds.js';

const RULES = {
  match_outcome: 1, group_position: 0,
  knockout_r32: 2, knockout_r16: 3, knockout_qf: 4, knockout_sf: 6,
  knockout_final: 6, knockout_winner: 8, third_place: 6,
};

// Two SFs already decided (team 1 and team 2 reached the final); the final is
// the only undecided match. Team ids 1 and 2 are the finalists.
function finalOnlyMatches(): OddsMatchIn[] {
  const m = (phase: any, index: number, extra: Partial<OddsMatchIn>): OddsMatchIn => ({
    phase, index, finished: false, homeTeamId: null, awayTeamId: null,
    homeScore: null, awayScore: null, penaltyWinnerId: null, ...extra,
  });
  return [
    m('sf', 0, { finished: true, homeTeamId: 1, awayTeamId: 9, homeScore: 2, awayScore: 0 }), // 1 wins
    m('sf', 1, { finished: true, homeTeamId: 2, awayTeamId: 8, homeScore: 1, awayScore: 0 }), // 2 wins
    m('final', 0, { homeTeamId: 1, awayTeamId: 2 }), // undecided
  ];
}

describe('computeKnockoutOdds', () => {
  it('splits a coin-flip final 50/50 and keeps both on the podium', () => {
    const entries: OddsEntryIn[] = [
      { id: 10, userId: 1, name: 'A', label: null, base: 20, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] },
      { id: 20, userId: 2, name: 'B', label: null, base: 20, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] },
    ];
    const out = computeKnockoutOdds(finalOnlyMatches(), entries, RULES);
    expect(out.exact).toBe(true);
    expect(out.remaining).toBe(1);
    expect(out.scenarios).toBe(2);
    const a = out.rows.find((r) => r.id === 10)!;
    const b = out.rows.find((r) => r.id === 20)!;
    expect(a.winPct).toBe(50);
    expect(b.winPct).toBe(50);
    // Only two entries → everyone is always top-3.
    expect(a.podiumPct).toBe(100);
    expect(b.podiumPct).toBe(100);
    expect(a.clinchedWin).toBe(false);
  });

  it('reports a mathematically-clinched leader as 100% and rivals as 0%', () => {
    const entries: OddsEntryIn[] = [
      // A is 100 pts ahead — no remaining KO result can be caught.
      { id: 10, userId: 1, name: 'A', label: null, base: 100, baseCorrect: 0, picks: [] },
      { id: 20, userId: 2, name: 'B', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] },
      { id: 30, userId: 3, name: 'C', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] },
    ];
    const out = computeKnockoutOdds(finalOnlyMatches(), entries, RULES);
    const a = out.rows.find((r) => r.id === 10)!;
    expect(a.winPct).toBe(100);
    expect(a.clinchedWin).toBe(true);
    expect(out.rows.find((r) => r.id === 20)!.winPct).toBe(0);
    expect(out.rows.find((r) => r.id === 30)!.winPct).toBe(0);
  });

  it('awards the champion final+winner and the losing finalist only final', () => {
    // One entry picks team 1 as champion. Force the final so team 1 wins by
    // using a decided final; remaining=0 → a single deterministic scenario.
    const matches = finalOnlyMatches().map((m) =>
      m.phase === 'final' ? { ...m, finished: true, homeScore: 3, awayScore: 1 } : m
    );
    const entries: OddsEntryIn[] = [
      { id: 10, userId: 1, name: 'Champ', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] },
      { id: 20, userId: 2, name: 'Runner', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] },
    ];
    const out = computeKnockoutOdds(matches, entries, RULES);
    expect(out.remaining).toBe(0);
    expect(out.scenarios).toBe(1);
    // Champ (team 1) is 1st in the only scenario, runner-up 2nd.
    expect(out.rows.find((r) => r.id === 10)!.winPct).toBe(100);
    expect(out.rows.find((r) => r.id === 20)!.winPct).toBe(0);
  });

  it('resolveTree + scoreEntry score a single chosen scenario (interactive what-if)', () => {
    const byPhase = groupByPhase(finalOnlyMatches());
    // Choose team 1 to win the final.
    const tree = resolveTree(byPhase, () => 1);
    expect(tree.rounds.final.winner).toBe(1);
    expect([...tree.finalists].sort()).toEqual([1, 2]);

    const champ = prepEntry({ id: 1, userId: 1, name: 'C', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] });
    const runner = prepEntry({ id: 2, userId: 2, name: 'R', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] });
    expect(scoreEntry(champ, tree, RULES).pts).toBe(RULES.knockout_final + RULES.knockout_winner); // 6 + 8
    expect(scoreEntry(runner, tree, RULES).pts).toBe(RULES.knockout_final); // 6 (reached final, didn't win)

    // With no choice made, the final is undecided → neither scores the final.
    const pending = resolveTree(byPhase, () => null);
    expect(pending.rounds.final.winner).toBe(null);
    expect(scoreEntry(champ, pending, RULES).pts).toBe(0);
  });
});

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

  it('omitting r32Participants keeps an unfinished R32 (even with known teams) undecided', () => {
    const ko = emptyKo();
    ko[0] = { ...ko[0], homeTeamId: 10, awayTeamId: 20 }; // known teams, NOT finished
    const byPhase = groupByPhase(ko);
    // a choose that WOULD pick team 10 if ever consulted for r32
    const tree = resolveTree(byPhase, (m) => (m.phase === 'r32' ? 10 : null));
    expect(tree.pw.r32.has(10)).toBe(false); // legacy: unfinished R32 → no winner
    expect(tree.rounds.r32[0].winner).toBe(null);
  });
});

describe('cascade regression: stale picks & 3rd place', () => {
  it('changing an R32 winner invalidates a downstream R16 pick for the team that no longer arrives', () => {
    const byPhase = groupByPhase(emptyKo());
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
    const byPhase = groupByPhase(emptyKo());
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

  it('a chosen R32 winner scores knockout_r32 for an entry that picked it (and not for the loser)', () => {
    const byPhase = groupByPhase(emptyKo());
    const parts = Array.from({ length: 16 }, (_, i) => ({ a: 100 + i * 2, b: 101 + i * 2 }));
    const tree = resolveTree(byPhase, (m) => (m.phase === 'r32' && m.index === 0 ? 100 : null), parts);
    const rules = { knockout_r32: 4 };
    const winnerPick = prepEntry({ id: 1, userId: 1, name: 'x', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'r32', slot: 0, teamId: 100 }] });
    expect(scoreEntry(winnerPick, tree, rules).pts).toBe(4);
    const loserPick = prepEntry({ id: 2, userId: 2, name: 'y', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'r32', slot: 0, teamId: 101 }] });
    expect(scoreEntry(loserPick, tree, rules).pts).toBe(0);
  });

  it('R32 occupant rule preserved: an even-slot pick whose odd sibling is filled is excluded from scoring', () => {
    const pe = prepEntry({ id: 1, userId: 1, name: 'x', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'r32', slot: 1, teamId: 50 }, { phase: 'r32', slot: 2, teamId: 60 }] });
    expect(pe.r32).toContain(50);      // odd slot 1 → scores normally
    expect(pe.r32).not.toContain(60);  // even slot 2 whose sibling slot 1 is filled → occupant, excluded
  });
});
