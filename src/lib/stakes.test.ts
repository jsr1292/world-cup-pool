import { describe, it, expect } from 'vitest';
import { computeStakes } from './stakes.js';
import { type OddsMatchIn, type OddsEntryIn } from './knockout-odds.js';

const RULES = {
  match_outcome: 1, group_position: 0,
  knockout_r32: 2, knockout_r16: 3, knockout_qf: 4, knockout_sf: 6,
  knockout_final: 6, knockout_winner: 8, third_place: 6,
};

// Two SFs decided (teams 1 and 2 reached the final); the final is the only
// undecided match, played between team 1 (home/a) and team 2 (away/b).
function finalOnlyMatches(): OddsMatchIn[] {
  const m = (phase: any, index: number, extra: Partial<OddsMatchIn>): OddsMatchIn => ({
    phase, index, finished: false, homeTeamId: null, awayTeamId: null,
    homeScore: null, awayScore: null, penaltyWinnerId: null, ...extra,
  });
  return [
    m('sf', 0, { finished: true, homeTeamId: 1, awayTeamId: 9, homeScore: 2, awayScore: 0 }),
    m('sf', 1, { finished: true, homeTeamId: 2, awayTeamId: 8, homeScore: 1, awayScore: 0 }),
    m('final', 0, { homeTeamId: 1, awayTeamId: 2 }),
  ];
}
const META = [{ id: 101, kickoff: null }, { id: 102, kickoff: null }, { id: 103, kickoff: '2026-07-19T19:00:00Z' }];
const team = (id: number) => ({ name: `T${id}`, flag: `f${id}` });

describe('computeStakes', () => {
  it('names an uncatchable leader as the certain champion', () => {
    const entries: OddsEntryIn[] = [
      { id: 10, userId: 1, name: 'Ana', label: null, base: 100, baseCorrect: 0, picks: [] }, // 100 ahead
      { id: 20, userId: 2, name: 'Ben', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] },
      { id: 30, userId: 3, name: 'Cid', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] },
    ];
    const s = computeStakes(finalOnlyMatches(), entries, RULES, META, team)!;
    expect(s).not.toBeNull();
    expect(s.champions).toEqual(['Ana']); // #1 in both final outcomes
  });

  it('reports which side of a decisive final wins the pool', () => {
    // Ben picks team 1 as champion, Cid picks team 2. Whoever's team wins the
    // final takes the pool — so the final decides it, but nobody has clinched yet.
    const entries: OddsEntryIn[] = [
      { id: 20, userId: 2, name: 'Ben', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 1 }] },
      { id: 30, userId: 3, name: 'Cid', label: null, base: 0, baseCorrect: 0, picks: [{ phase: 'final', slot: 1, teamId: 2 }] },
    ];
    const s = computeStakes(finalOnlyMatches(), entries, RULES, META, team)!;
    expect(s.champions).toBeNull(); // winner varies by the final's result
    expect(s.matches).toHaveLength(1);
    const m = s.matches[0];
    expect(m.id).toBe(103);           // db id threaded from META for the final
    expect(m.phase).toBe('final');
    expect(m.home).toEqual({ name: 'T1', flag: 'f1' }); // team 1 is the home/a side
    expect(m.away).toEqual({ name: 'T2', flag: 'f2' });
    expect(m.winnersIfHome).toEqual(['Ben']); // team 1 wins → Ben
    expect(m.winnersIfAway).toEqual(['Cid']); // team 2 wins → Cid
  });

  it('returns null when nothing is left to decide', () => {
    const decided = finalOnlyMatches().map((m) =>
      m.phase === 'final' ? { ...m, finished: true, homeScore: 1, awayScore: 0 } : m
    );
    const entries: OddsEntryIn[] = [
      { id: 20, userId: 2, name: 'Ben', label: null, base: 0, baseCorrect: 0, picks: [] },
    ];
    expect(computeStakes(decided, entries, RULES, META, team)).toBeNull();
  });
});
