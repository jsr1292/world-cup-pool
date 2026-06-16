import { describe, it, expect } from 'vitest';
import { rankThirds, assignThirds, buildR32, type ThirdInfo } from './sim-bracket.js';
import { THIRD_GROUP_MAP } from './bracket-2026.js';
import { rankGroup, type GsMatch } from './group-standings.js';

describe('rankThirds', () => {
  it('takes the 8 best by points → GD → GF', () => {
    const thirds: ThirdInfo[] = 'ABCDEFGHIJKL'.split('').map((group, i) => ({
      group, teamId: 100 + i, points: i, gd: 0, gf: 0, // L (i=11) best … A (i=0) worst
    }));
    const { ranked, qualifyingGroups } = rankThirds(thirds);
    expect(ranked[0].group).toBe('L');
    expect(qualifyingGroups.size).toBe(8);
    // bottom 4 (A,B,C,D) miss out
    expect(qualifyingGroups.has('A')).toBe(false);
    expect(qualifyingGroups.has('L')).toBe(true);
  });

  it('breaks GD/GF ties before falling back to group letter', () => {
    const thirds: ThirdInfo[] = [
      { group: 'A', teamId: 1, points: 3, gd: 2, gf: 5 },
      { group: 'B', teamId: 2, points: 3, gd: 2, gf: 4 }, // same pts+gd, fewer gf → below A
    ];
    expect(rankThirds(thirds).ranked.map((t) => t.group)).toEqual(['A', 'B']);
  });
});

describe('assignThirds', () => {
  it('returns a perfect matching that respects THIRD_GROUP_MAP', () => {
    const qualifying = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    const res = assignThirds(qualifying);
    expect(res).not.toBeNull();
    const slots = Object.keys(res!).map(Number);
    expect(slots.length).toBe(8);
    // every assigned group is allowed in its slot, and all 8 used exactly once
    const used = new Set<string>();
    for (const s of slots) {
      expect(THIRD_GROUP_MAP[s]).toContain(res![s]);
      expect(used.has(res![s])).toBe(false);
      used.add(res![s]);
    }
    expect(used).toEqual(qualifying);
  });
});

describe('full bracket integration', () => {
  it('a fully-decided tournament fills all 32 R32 slots with distinct teams', () => {
    const GROUPS = 'ABCDEFGHIJKL'.split('');
    const winners: Record<string, number | undefined> = {}, runners: Record<string, number | undefined> = {}, thirdByGroup: Record<string, number | undefined> = {};
    const thirds: ThirdInfo[] = [];
    GROUPS.forEach((g, gi) => {
      const [t1, t2, t3, t4] = [gi * 4 + 1, gi * 4 + 2, gi * 4 + 3, gi * 4 + 4];
      // round-robin where the lower-seeded team always wins (t1 > t2 > t3 > t4)
      const wins = (h: number, a: number): GsMatch => ({ homeTeamId: h, awayTeamId: a, homeScore: 1, awayScore: 0 });
      const gms = [wins(t1, t2), wins(t1, t3), wins(t1, t4), wins(t2, t3), wins(t2, t4), wins(t3, t4)];
      const order = rankGroup(gms);
      expect(order).toEqual([t1, t2, t3, t4]);
      winners[g] = order[0]; runners[g] = order[1]; thirdByGroup[g] = order[2];
      thirds.push({ group: g, teamId: order[2], points: 3, gd: 0, gf: 1 });
    });
    const { qualifyingGroups } = rankThirds(thirds);
    const assignment = assignThirds(qualifyingGroups);
    const r32 = buildR32({ winners, runners, thirdByGroup, thirdsAssignment: assignment });
    const ids = r32.flatMap((m) => [m.a.teamId, m.b.teamId]);
    expect(ids.every((id) => id != null)).toBe(true);        // no empty slots
    expect(new Set(ids).size).toBe(32);                      // 32 distinct teams
  });
});

describe('buildR32', () => {
  it('resolves group winners/runners and labels unknown slots', () => {
    const r32 = buildR32({
      winners: { E: 50 }, runners: {}, thirdByGroup: {}, thirdsAssignment: null,
    });
    const m74 = r32[0]; // 1E vs 3rd(...)
    expect(m74.a).toMatchObject({ teamId: 50, label: '1E' });
    expect(m74.b).toMatchObject({ teamId: null, third: true }); // unassigned third
  });
});
