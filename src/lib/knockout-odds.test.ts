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
