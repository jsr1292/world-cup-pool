// Prize-money maths for money pools, shared shape with the Clasificación hub
// (src/routes/pool/[id]/+page.svelte), which keeps its own inline copy.
// Keep the two in step: if the split changes, it changes in both places.

export const PRIZE_SPLITS = [
  { label: '1.º', pct: 0.6 },
  { label: '2.º', pct: 0.25 },
  { label: '3.º', pct: 0.15 },
];

/**
 * Prize per entry under the "combined positions" rule: entries level on points
 * share the SUMMED prizes of every finishing place they occupy, split equally.
 * So 2 tied for 2nd occupy places 2–3 and share the 2nd+3rd prizes (no separate
 * 3rd is awarded); 5 tied for 1st occupy places 1–5 and share the whole pot.
 *
 * `scoresDesc` MUST be sorted descending, with tied scores adjacent — the rule
 * is positional. Returns prizes aligned index-for-index with that input.
 */
export function computePrizes(scoresDesc: number[], pot: number): number[] {
  const out: number[] = new Array(scoresDesc.length).fill(0);
  if (pot <= 0) return out;
  const pcts = PRIZE_SPLITS.map((s) => s.pct); // 0-based finishing place → share
  let i = 0;
  while (i < scoresDesc.length) {
    let j = i;
    while (j < scoresDesc.length && scoresDesc[j] === scoresDesc[i]) j++;
    let sumPct = 0;
    for (let p = i; p < j; p++) sumPct += pcts[p] ?? 0; // places beyond 3rd add 0
    const share = (pot * sumPct) / (j - i);
    for (let p = i; p < j; p++) out[p] = share;
    i = j;
  }
  return out;
}

/**
 * Prize per entry id, for callers that render a filtered or reordered view of
 * the board. `boardDesc` must be the FULL board sorted descending — prizes
 * depend on every entry's finishing place, so computing them over a filtered
 * subset would silently promote whoever survived the filter.
 */
export function prizesByEntryId(
  boardDesc: { id: number; score: number }[],
  pot: number,
): Record<number, number> {
  const prizes = computePrizes(boardDesc.map((e) => e.score), pot);
  const out: Record<number, number> = {};
  boardDesc.forEach((e, i) => { out[e.id] = prizes[i]; });
  return out;
}

const CUR_SYMBOL: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };

export function fmtMoney(n: number, currency: string): string {
  const sym = CUR_SYMBOL[currency] ?? '';
  return sym ? `${n.toFixed(2)}${sym}` : `${n.toFixed(2)} ${currency || ''}`.trim();
}
