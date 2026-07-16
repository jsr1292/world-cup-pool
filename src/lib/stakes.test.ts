import { describe, it, expect } from 'vitest';
import { computeStakes } from './stakes.js';
import {
  groupByPhase, resolveTree, prepEntry, scoreEntry,
  type OddsMatchIn, type OddsEntryIn,
} from './knockout-odds.js';

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

describe('finalAndThirdMatches — fixture sanity', () => {
  it('genuinely scores a 3rd-place-only pick (guards against the fixture going vacuous silently)', () => {
    // finalAndThirdMatches() only exercises the 3rd-place path because the QF
    // round is finished, which lets resolveTree cascade the SF losers to real
    // team ids for the 3rd-place match. CLAUDE.md names 3rd-place staleness
    // as a known bug class — if that cascade ever broke, every "3rd place"
    // test above would silently stop testing anything. Fail loudly instead:
    // score an entry whose ONLY pick is the 3rd-place winner directly against
    // the resolved tree, in the branch where that pick wins.
    const byPhase = groupByPhase(finalAndThirdMatches());
    const choose = (m: OddsMatchIn, a: number | null): number | null => a; // home wins every undecided match, incl. team 9 in the 3rd-place playoff
    const tree = resolveTree(byPhase, choose);
    expect(tree.rounds.third.winner).toBe(9); // sanity: the cascade did resolve sfLose to [9, 8]

    const onlyThirdPick = entry(99, 'Probe', 0, [{ phase: '3rd', slot: 1, teamId: 9 }]);
    const { pts, correct } = scoreEntry(prepEntry(onlyThirdPick), tree, RULES);
    expect(pts).toBeGreaterThan(0); // third_place=6 must actually be credited
    expect(correct).toBe(1);
  });
});

describe('computeStakes — settled podium', () => {
  it('reports a full podium when the leaders move in lockstep', () => {
    // Identical picks, different bases: every future adds the same points to all
    // four, so the gaps (5, 6, 4) never close.
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

  it('does not let a tied branch leak a false single-winner claim (regression: points-only winners + intersection)', () => {
    // Ana base 100 flat, no picks. Ben base 94, with a `3rd` pick on team 9
    // worth 6: if 9 wins the 3rd-place match, Ben ties Ana at 100 (they'd
    // split the pot); if 8 wins, Ben stays at 94 and Ana is alone.
    //
    // The final's result never touches either entry's score, so it decides
    // nothing — but the OLD intersection-based winnersIfHome/winnersIfAway
    // computed {Ana,Ben}∩{Ana} = {Ana} on both sides of the final, falsely
    // claiming Ana wins outright regardless, when a tie is actually possible.
    // Set-identity per branch must suppress that: the final's two branches
    // each straddle both a lone-Ana future and a tied future, so neither
    // side may name anyone.
    const entries = [
      entry(10, 'Ana', 100),
      entry(20, 'Ben', 94, [{ phase: '3rd', slot: 1, teamId: 9 }]),
    ];
    const s = computeStakes(finalAndThirdMatches(), entries, RULES, META8, team)!;

    const third = s.matches.find((m) => m.phase === '3rd');
    expect(third).toBeDefined();
    expect(third!.winnersIfHome).toEqual(['Ana', 'Ben']); // 9 wins → tie, both named
    expect(third!.winnersIfAway).toEqual(['Ana']);        // 8 wins → Ana alone, consistently

    // The final decides nothing for either entry — it must not appear at all,
    // not be reported with a false single-name claim on either side.
    expect(s.matches.find((m) => m.phase === 'final')).toBeUndefined();
  });
});
