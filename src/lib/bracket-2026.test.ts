import { describe, it, expect } from 'vitest';
import {
  WILDCARD, R32_MAP, R32_TO_R16, R32_LABELS, THIRD_GROUP_MAP,
} from './bracket-2026.js';

// ── Official FIFA World Cup 2026 knockout bracket ──────────────────────────
// Source: Wikipedia "2026 FIFA World Cup knockout stage" (matches 73–104).
// Each R32 match expressed as a canonical, order-independent matchup key.
const norm = (a: string, b: string) => [a, b].sort().join(' / ');

// match number → canonical matchup
const OFFICIAL_R32: Record<number, string> = {
  73: norm('2A', '2B'),
  74: norm('1E', '3:A/B/C/D/F'),
  75: norm('1F', '2C'),
  76: norm('1C', '2F'),
  77: norm('1I', '3:C/D/F/G/H'),
  78: norm('2E', '2I'),
  79: norm('1A', '3:C/E/F/H/I'),
  80: norm('1L', '3:E/H/I/J/K'),
  81: norm('1D', '3:B/E/F/I/J'),
  82: norm('1G', '3:A/E/H/I/J'),
  83: norm('2K', '2L'),
  84: norm('1H', '2J'),
  85: norm('1B', '3:E/F/G/I/J'),
  86: norm('1J', '2H'),
  87: norm('1K', '3:D/E/I/J/L'),
  88: norm('2D', '2G'),
};

// Official partitions of the 16 R32 matches (by match number) at each level —
// i.e. which R32 matches share a Round-of-16, a Quarterfinal, a Semifinal.
// Derived from the official feeds: R16 M89=W74+W77 …; QF M97=M89+M90 …;
// SF M101=M97+M98, M102=M99+M100.
const OFFICIAL_R16_GROUPS: number[][] = [
  [74, 77], [73, 75], [76, 78], [79, 80], [83, 84], [81, 82], [86, 88], [85, 87],
];
const OFFICIAL_QF_GROUPS: number[][] = [
  [74, 77, 73, 75], [83, 84, 81, 82], [76, 78, 79, 80], [86, 88, 85, 87],
];
const OFFICIAL_SF_GROUPS: number[][] = [
  [74, 77, 73, 75, 83, 84, 81, 82], [76, 78, 79, 80, 86, 88, 85, 87],
];

// Order-independent serialization of a partition (set of groups of matchup keys).
const serializeGroups = (groups: string[][]) =>
  groups.map(g => [...g].sort().join('|')).sort().join(' || ');
const fromMatchNums = (groups: number[][]) =>
  serializeGroups(groups.map(g => g.map(n => OFFICIAL_R32[n])));
// App partition: split the 16 R32 indices into consecutive chunks of `size`.
const appPartition = (size: number) => {
  const out: string[][] = [];
  for (let i = 0; i < 16; i += size) {
    out.push(Array.from({ length: size }, (_, k) => codedR32Key(R32_TO_R16[i + k])));
  }
  return serializeGroups(out);
};

// Build the canonical matchup for a coded R32 index (resolving wildcards via
// THIRD_GROUP_MAP so the 3rd-place candidate set is part of the identity).
function codedR32Key(i: number): string {
  const m = R32_MAP[i];
  const side = (g: string, p: number) => {
    if (g === WILDCARD) {
      const groups = THIRD_GROUP_MAP[i];
      expect(groups, `wildcard R32 index ${i} must have THIRD_GROUP_MAP entry`).toBeTruthy();
      return `3:${[...groups].sort().join('/')}`;
    }
    return `${p}${g}`;
  };
  return norm(side(m.t1g, m.t1p), side(m.t2g, m.t2p));
}

describe('bracket-2026: structure', () => {
  it('has 16 R32 matchups, labels, and a sequential R32→R16 feed', () => {
    expect(R32_MAP).toHaveLength(16);
    expect(R32_LABELS).toHaveLength(16);
    expect(R32_TO_R16).toEqual(Array.from({ length: 16 }, (_, i) => i));
  });

  it('every wildcard R32 entry has a matching THIRD_GROUP_MAP key (and vice-versa)', () => {
    const wildcardIdx = R32_MAP.map((m, i) => (m.t2g === WILDCARD || m.t1g === WILDCARD ? i : -1)).filter(i => i >= 0);
    expect(wildcardIdx.sort((a, b) => a - b)).toEqual(
      Object.keys(THIRD_GROUP_MAP).map(Number).sort((a, b) => a - b),
    );
    // FIFA: exactly 8 of the 12 third-placed teams advance → 8 wildcard slots.
    expect(wildcardIdx).toHaveLength(8);
  });

  it('all 12 group winners, 12 runners-up appear exactly once across R32', () => {
    const seen = new Set<string>();
    for (const m of R32_MAP) {
      for (const [g, p] of [[m.t1g, m.t1p], [m.t2g, m.t2p]] as [string, number][]) {
        if (g === WILDCARD) continue;
        seen.add(`${p}${g}`);
      }
    }
    const groups = 'ABCDEFGHIJKL'.split('');
    for (const g of groups) {
      expect(seen.has(`1${g}`), `winner of group ${g} must appear in R32`).toBe(true);
      expect(seen.has(`2${g}`), `runner-up of group ${g} must appear in R32`).toBe(true);
    }
  });
});

describe('bracket-2026: matches the official 2026 tree', () => {
  it('every coded R32 matchup equals an official R32 matchup (bijective)', () => {
    const official = new Set(Object.values(OFFICIAL_R32));
    const coded = R32_MAP.map((_, i) => codedR32Key(i));
    expect(new Set(coded).size).toBe(16); // no duplicates
    for (const key of coded) {
      expect(official.has(key), `coded matchup "${key}" must be an official R32 matchup`).toBe(true);
    }
  });

  it('R16 groupings (which R32 winners meet) match the official bracket', () => {
    expect(appPartition(2)).toBe(fromMatchNums(OFFICIAL_R16_GROUPS));
  });

  it('QF groupings match the official bracket', () => {
    expect(appPartition(4)).toBe(fromMatchNums(OFFICIAL_QF_GROUPS));
  });

  it('SF half-draws match the official bracket', () => {
    expect(appPartition(8)).toBe(fromMatchNums(OFFICIAL_SF_GROUPS));
  });
});
