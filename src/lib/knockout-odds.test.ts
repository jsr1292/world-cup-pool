import { describe, it, expect } from 'vitest';
import { computeKnockoutOdds, type OddsMatchIn, type OddsEntryIn } from './knockout-odds.js';

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
});
