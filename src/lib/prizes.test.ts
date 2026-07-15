import { describe, it, expect } from 'vitest';
import { PRIZE_SPLITS, computePrizes, prizesByEntryId, fmtMoney } from './prizes.js';

// The reference implementation, copied verbatim from the Clasificación hub
// (src/routes/pool/[id]/+page.svelte). computePrizes must agree with it for
// every input: the money shown in the Simulador has to match the money shown
// on the leaderboard, or players will (rightly) not trust either number.
function hubReference(scores: number[], pot: number): number[] {
  const out: number[] = new Array(scores.length).fill(0);
  if (pot <= 0) return out;
  const pcts = PRIZE_SPLITS.map((s) => s.pct);
  let i = 0;
  while (i < scores.length) {
    let j = i;
    while (j < scores.length && scores[j] === scores[i]) j++;
    let sumPct = 0;
    for (let p = i; p < j; p++) sumPct += pcts[p] ?? 0;
    const share = (pot * sumPct) / (j - i);
    for (let p = i; p < j; p++) out[p] = share;
    i = j;
  }
  return out;
}

const POT = 100;

describe('computePrizes — combined-positions rule', () => {
  it('pays 60/25/15 when nobody ties', () => {
    expect(computePrizes([50, 40, 30, 20], POT)).toEqual([60, 25, 15, 0]);
  });

  // The question that started this feature: two level on points for 2nd occupy
  // places 2 AND 3, so they share 25%+15% between them — and no separate 3rd
  // prize is awarded to anyone below them.
  it('two tied for 2nd share the 2nd+3rd prizes (20 each), 4th gets nothing', () => {
    expect(computePrizes([50, 40, 40, 30], POT)).toEqual([60, 20, 20, 0]);
  });

  it('two tied for 1st share 1st+2nd, and a sole 3rd still gets the 3rd prize', () => {
    expect(computePrizes([50, 50, 30, 20], POT)).toEqual([42.5, 42.5, 15, 0]);
  });

  it('five tied for 1st share the entire pot evenly', () => {
    expect(computePrizes([9, 9, 9, 9, 9], POT)).toEqual([20, 20, 20, 20, 20]);
  });

  it('three tied for 3rd split only the 3rd prize (places 3,4,5 → 15%+0+0)', () => {
    expect(computePrizes([50, 40, 30, 30, 30], POT)).toEqual([60, 25, 5, 5, 5]);
  });

  it('pays nothing for ties entirely below the podium', () => {
    const prizes = computePrizes([50, 40, 30, 20, 20, 20], POT);
    expect(prizes.slice(3)).toEqual([0, 0, 0]);
  });

  it('pays nothing at all when there is no pot (free pool)', () => {
    expect(computePrizes([50, 40, 30], 0)).toEqual([0, 0, 0]);
    expect(computePrizes([50, 40, 30], -5)).toEqual([0, 0, 0]);
  });

  it('handles an empty board', () => {
    expect(computePrizes([], POT)).toEqual([]);
  });

  // Pot conservation: with 3+ distinct-or-tied entries the whole pot is always
  // paid out and never exceeded, however the ties fall.
  it.each([
    [[50, 40, 30]],
    [[50, 40, 40]],
    [[50, 50, 50]],
    [[50, 50, 30, 20]],
    [[50, 40, 40, 40, 10]],
    [[7, 7, 7, 7, 7, 7, 7]],
  ])('conserves the pot exactly for %j', (scores) => {
    const total = computePrizes(scores as number[], POT).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(POT, 10);
  });

  // Known, deliberate quirk of the live rule, pinned here so nobody "fixes" it
  // by accident: with fewer than 3 entries there aren't enough finishing places
  // to absorb the whole pot, so part of it goes unassigned.
  it('leaves part of the pot unassigned with fewer than 3 entries (live behaviour)', () => {
    expect(computePrizes([50, 40], POT)).toEqual([60, 25]); // 15% unassigned
    expect(computePrizes([50], POT)).toEqual([60]); // 40% unassigned
  });

  it.each([
    [[50, 40, 30, 20]],
    [[50, 40, 40, 30]],
    [[50, 50, 30]],
    [[9, 9, 9, 9, 9]],
    [[50, 40, 30, 30, 30]],
    [[]],
  ])('matches the Clasificación reference implementation for %j', (scores) => {
    expect(computePrizes(scores as number[], POT)).toEqual(hubReference(scores as number[], POT));
  });
});

describe('prizesByEntryId', () => {
  const board = [
    { id: 11, score: 50 },
    { id: 22, score: 40 },
    { id: 33, score: 40 },
    { id: 44, score: 30 },
  ];

  it('keys prizes by entry id, not board position', () => {
    expect(prizesByEntryId(board, POT)).toEqual({ 11: 60, 22: 20, 33: 20, 44: 0 });
  });

  // The Simulador renders `visibleLeaderboard` ("Solo cambios" hides everyone
  // who didn't move), but prizes must reflect the FULL board. If the caller
  // ever computed over the filtered list, the survivor would inherit 1st place
  // money — this pins the id→prize mapping as independent of what's rendered.
  it('gives a filtered view the same money as the full board', () => {
    const full = prizesByEntryId(board, POT);
    const visible = board.filter((e) => e.id === 33 || e.id === 44);
    for (const e of visible) expect(full[e.id]).toBe(prizesByEntryId(board, POT)[e.id]);
    expect(full[33]).toBe(20);
    expect(full[44]).toBe(0);
  });

  it('would misprice a filtered board — proving why the full board is required', () => {
    const filtered = board.filter((e) => e.id === 33 || e.id === 44);
    // Computed over only the movers, 33 looks like the winner and takes 60.
    expect(prizesByEntryId(filtered, POT)[33]).toBe(60);
    // Over the real board it is a tied-2nd sharing 2nd+3rd.
    expect(prizesByEntryId(board, POT)[33]).toBe(20);
  });

  it('returns all-zero when there is no pot', () => {
    expect(prizesByEntryId(board, 0)).toEqual({ 11: 0, 22: 0, 33: 0, 44: 0 });
  });

  it('handles an empty board', () => {
    expect(prizesByEntryId([], POT)).toEqual({});
  });
});

describe('fmtMoney', () => {
  it('appends the symbol for known currencies', () => {
    expect(fmtMoney(20, 'EUR')).toBe('20.00€');
    expect(fmtMoney(1.5, 'USD')).toBe('1.50$');
    expect(fmtMoney(0.5, 'GBP')).toBe('0.50£');
  });

  it('falls back to the raw code for unknown currencies', () => {
    expect(fmtMoney(20, 'CHF')).toBe('20.00 CHF');
  });

  it('omits a missing currency rather than printing undefined', () => {
    expect(fmtMoney(20, '')).toBe('20.00');
  });
});
