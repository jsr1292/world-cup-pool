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
