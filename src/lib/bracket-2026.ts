/**
 * FIFA World Cup 2026 knockout bracket — single source of truth.
 *
 * The 48-team format sends 32 teams to the Round of 32: the 12 group winners,
 * the 12 runners-up, and the 8 best third-placed teams. The matchups below are
 * the OFFICIAL bracket (verified against Wikipedia "2026 FIFA World Cup
 * knockout stage", matches 73–104).
 *
 * R32_MAP is ordered so the *sequential* cascade reproduces the official tree:
 *   R16[i]   = winner(R32[2i])  vs winner(R32[2i+1])
 *   QF[i]    = winner(R16[2i])  vs winner(R16[2i+1])
 *   SF[i]    = winner(QF[2i])   vs winner(QF[2i+1])
 *   Final    = winner(SF[0])    vs winner(SF[1])
 *   3rd      = loser(SF[0])     vs loser(SF[1])
 * Left wing  (R32 indices 0–7)  feeds SF M101; right wing (8–15) feeds SF M102.
 *
 * bracket-2026.test.ts asserts this tree equals the official bracket, so a
 * reorder that breaks fidelity fails CI.
 */

/** Sentinel for a wildcard R32 entry (a 3rd-placed team, unknown pre-draw). */
export const WILDCARD = '?';

export interface R32Matchup {
  t1g: string; // group letter of the first team (or WILDCARD)
  t1p: number; // finishing position in that group (1=winner, 2=runner-up, 3=third)
  t2g: string;
  t2p: number;
}

/** Official FIFA match number for each R32 index (for labels/debugging). */
export const R32_OFFICIAL_MATCH = [
  74, 77, 73, 75, 83, 84, 81, 82, // left wing  → SF M101
  76, 78, 79, 80, 86, 88, 85, 87, // right wing → SF M102
];

export const R32_MAP: R32Matchup[] = [
  // LEFT WING (→ SF M101)
  { t1g: 'E', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M74: 1E vs 3rd(A/B/C/D/F)
  { t1g: 'I', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M77: 1I vs 3rd(C/D/F/G/H)
  { t1g: 'A', t1p: 2, t2g: 'B', t2p: 2 },      // M73: 2A vs 2B
  { t1g: 'F', t1p: 1, t2g: 'C', t2p: 2 },      // M75: 1F vs 2C
  { t1g: 'K', t1p: 2, t2g: 'L', t2p: 2 },      // M83: 2K vs 2L
  { t1g: 'H', t1p: 1, t2g: 'J', t2p: 2 },      // M84: 1H vs 2J
  { t1g: 'D', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M81: 1D vs 3rd(B/E/F/I/J)
  { t1g: 'G', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M82: 1G vs 3rd(A/E/H/I/J)
  // RIGHT WING (→ SF M102)
  { t1g: 'C', t1p: 1, t2g: 'F', t2p: 2 },      // M76: 1C vs 2F
  { t1g: 'E', t1p: 2, t2g: 'I', t2p: 2 },      // M78: 2E vs 2I
  { t1g: 'A', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M79: 1A vs 3rd(C/E/F/H/I)
  { t1g: 'L', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M80: 1L vs 3rd(E/H/I/J/K)
  { t1g: 'J', t1p: 1, t2g: 'H', t2p: 2 },      // M86: 1J vs 2H
  { t1g: 'D', t1p: 2, t2g: 'G', t2p: 2 },      // M88: 2D vs 2G
  { t1g: 'B', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M85: 1B vs 3rd(E/F/G/I/J)
  { t1g: 'K', t1p: 1, t2g: WILDCARD, t2p: 3 }, // M87: 1K vs 3rd(D/E/I/J/L)
];

/** R32 → R16: each adjacent R32 pair feeds one R16 slot. */
export const R32_TO_R16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const R32_LABELS = [
  '1E vs 3rd(A/B/C/D/F)', '1I vs 3rd(C/D/F/G/H)', '2A vs 2B', '1F vs 2C',
  '2K vs 2L', '1H vs 2J', '1D vs 3rd(B/E/F/I/J)', '1G vs 3rd(A/E/H/I/J)',
  '1C vs 2F', '2E vs 2I', '1A vs 3rd(C/E/F/H/I)', '1L vs 3rd(E/H/I/J/K)',
  '1J vs 2H', '2D vs 2G', '1B vs 3rd(E/F/G/I/J)', '1K vs 3rd(D/E/I/J/L)',
];

export const R16_LABELS = [
  'W(R32-1) vs W(R32-2)',   // M89
  'W(R32-3) vs W(R32-4)',   // M90
  'W(R32-5) vs W(R32-6)',   // M93
  'W(R32-7) vs W(R32-8)',   // M94
  'W(R32-9) vs W(R32-10)',  // M91
  'W(R32-11) vs W(R32-12)', // M92
  'W(R32-13) vs W(R32-14)', // M95
  'W(R32-15) vs W(R32-16)', // M96
];

export const QF_LABELS = [
  'W(R16-1) vs W(R16-2)', // M97
  'W(R16-3) vs W(R16-4)', // M98
  'W(R16-5) vs W(R16-6)', // M99
  'W(R16-7) vs W(R16-8)', // M100
];

export const SF_LABELS = ['W(QF-1) vs W(QF-2)', 'W(QF-3) vs W(QF-4)'];
export const FINAL_LABEL = 'W(SF-1) vs W(SF-2)';
export const THIRD_LABEL = 'L(SF-1) vs L(SF-2)';

/**
 * Maps each wildcard R32 index → the groups whose 3rd-placed team can feed it.
 * Keys MUST stay in lockstep with the WILDCARD entries in R32_MAP.
 */
export const THIRD_GROUP_MAP: Record<number, string[]> = {
  0:  ['A', 'B', 'C', 'D', 'F'], // M74: 1E vs 3rd(A/B/C/D/F)
  1:  ['C', 'D', 'F', 'G', 'H'], // M77: 1I vs 3rd(C/D/F/G/H)
  6:  ['B', 'E', 'F', 'I', 'J'], // M81: 1D vs 3rd(B/E/F/I/J)
  7:  ['A', 'E', 'H', 'I', 'J'], // M82: 1G vs 3rd(A/E/H/I/J)
  10: ['C', 'E', 'F', 'H', 'I'], // M79: 1A vs 3rd(C/E/F/H/I)
  11: ['E', 'H', 'I', 'J', 'K'], // M80: 1L vs 3rd(E/H/I/J/K)
  14: ['E', 'F', 'G', 'I', 'J'], // M85: 1B vs 3rd(E/F/G/I/J)
  15: ['D', 'E', 'I', 'J', 'L'], // M87: 1K vs 3rd(D/E/I/J/L)
};
