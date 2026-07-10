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
    id, userId: id, name: 'U' + id, label: null, live: base,
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

  it('finished KO with zero picks: total equals live total_score and delta is zero', () => {
    const rules = { knockout_r32: 3 };
    const byPhase = emptyByPhase();
    // r32[0] finished: team 10 beat team 20
    byPhase.r32[0] = { phase: 'r32', index: 0, finished: true, homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 1, penaltyWinnerId: null };
    const tree = resolveTree(byPhase, () => null); // no picks; finished r32 resolves itself
    const totalScore = 15, realizedKO = 3;         // entry already earned knockout_r32
    const e: UnifiedEntry = {
      id: 1, userId: 1, name: 'A', label: null, live: totalScore,
      prepped: prepEntry({ id: 1, userId: 1, name: 'A', label: null, base: totalScore - realizedKO, baseCorrect: 0, picks: [{ phase: 'r32', slot: 0, teamId: 10 }] }),
      groupPicks: {}, groupOrders: {},
    };
    const rows = computeUnifiedProjection([e], tree, rules, baseCtx);
    expect(rows[0].total).toBe(totalScore);       // base(12) + re-awarded knockout_r32(3)
    expect(rows[0].total - rows[0].live).toBe(0); // no spurious delta
  });
});
