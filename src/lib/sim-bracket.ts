// Pure helpers for the simulator's qualification + Round-of-32 projection.
// Group winners/runners-up fill fixed R32 slots; the 8 best third-placed teams
// fill the wildcard slots, assigned to a slot whose allowed-group set (from the
// official THIRD_GROUP_MAP) contains their group. We resolve that via a small
// bipartite matching — any constraint-respecting assignment is a valid bracket,
// though FIFA's published combination table may pick a different valid one, so
// the UI labels third-placed slots as approximate.
import { R32_MAP, THIRD_GROUP_MAP, R32_OFFICIAL_MATCH, WILDCARD } from './bracket-2026.js';
import { rankGroup, type GsMatch } from './group-standings.js';

export interface ThirdInfo { group: string; teamId: number; points: number; gd: number; gf: number; }

/** Rank third-placed teams (FIFA: points, GD, GF; then group letter to break
 *  the remaining tie deterministically). Top 8 qualify. */
export function rankThirds(thirds: ThirdInfo[]): { ranked: ThirdInfo[]; qualifyingGroups: Set<string> } {
  const ranked = [...thirds].sort(
    (a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group)
  );
  return { ranked, qualifyingGroups: new Set(ranked.slice(0, 8).map((t) => t.group)) };
}

/** Assign each qualifying group's third to a wildcard R32 slot (slotIndex →
 *  group). Returns null if no perfect matching exists. */
export function assignThirds(qualifyingGroups: Set<string>): Record<number, string> | null {
  const slots = Object.keys(THIRD_GROUP_MAP).map(Number);
  const allowed: Record<number, string[]> = {};
  for (const s of slots) allowed[s] = THIRD_GROUP_MAP[s].filter((g) => qualifyingGroups.has(g));

  const groupOfSlot: Record<number, string> = {};
  const tryAssign = (g: string, seen: Set<number>): boolean => {
    for (const s of slots) {
      if (!allowed[s].includes(g) || seen.has(s)) continue;
      seen.add(s);
      if (groupOfSlot[s] === undefined || tryAssign(groupOfSlot[s], seen)) {
        groupOfSlot[s] = g;
        return true;
      }
    }
    return false;
  };
  for (const g of qualifyingGroups) {
    if (!tryAssign(g, new Set())) return null;
  }
  return groupOfSlot;
}

export interface SlotTeam { teamId: number | null; label: string; third: boolean; }
export interface R32Matchup { index: number; official: number; a: SlotTeam; b: SlotTeam; }

/** Build the 16 R32 matchups from resolved group placements. Unknown teams come
 *  back with teamId null and a positional label (e.g. "1E", "3.º?"). */
export function buildR32(opts: {
  winners: Record<string, number | undefined>;
  runners: Record<string, number | undefined>;
  thirdByGroup: Record<string, number | undefined>;
  thirdsAssignment: Record<number, string> | null;
}): R32Matchup[] {
  const { winners, runners, thirdByGroup, thirdsAssignment } = opts;
  return R32_MAP.map((mu, i) => {
    const resolve = (g: string, p: number): SlotTeam => {
      if (g === WILDCARD) {
        const grp = thirdsAssignment?.[i];
        return { teamId: grp ? (thirdByGroup[grp] ?? null) : null, label: grp ? `3.º ${grp}` : '3.º ?', third: true };
      }
      const id = p === 1 ? winners[g] : p === 2 ? runners[g] : thirdByGroup[g];
      return { teamId: id ?? null, label: `${p}${g}`, third: false };
    };
    return { index: i, official: R32_OFFICIAL_MATCH[i], a: resolve(mu.t1g, mu.t1p), b: resolve(mu.t2g, mu.t2p) };
  });
}

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
