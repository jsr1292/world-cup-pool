// Pure knockout-probability engine. Given the current knockout bracket (some
// matches decided, some pending), every pool member's bracket picks, and their
// FIXED points (everything already locked — group points + already-decided
// knockout points), this enumerates every still-possible combination of the
// remaining matches and reports, per member, the fraction of futures in which
// they finish 1st ("win") or top-3 ("podium").
//
// The bracket cascade is the FIFA 2026 tree (see bracket-2026.ts): DB knockout
// matches ordered by sort_order within a phase are already in bracket-index
// order, so child[i] takes the winners of parents [2i] and [2i+1]:
//   r16[i] ← r32[2i], r32[2i+1]   qf[i] ← r16[2i], r16[2i+1]
//   sf[i]  ← qf[2i],  qf[2i+1]    final ← sf[0], sf[1]   3rd ← losers(sf[0], sf[1])
//
// Scoring mirrors calculateBracketScores in server/scoring.ts exactly: a pick
// scores knockout_<phase> when its team wins a match in that phase; the champion
// (final winner) also gets knockout_winner; a correctly-picked losing finalist
// gets knockout_final; the third-place match winner gets third_place; and a
// non-advancing R32 wildcard occupant (an even slot whose sibling odd slot is
// also filled) never scores.
//
// Pure and framework-free (like group-standings.ts) so it runs on client or
// server and is unit-testable.

export type Phase = 'r32' | 'r16' | 'qf' | 'sf' | '3rd' | 'final';

export interface OddsMatchIn {
  phase: Phase;
  index: number; // 0-based position within its phase (sort_order order)
  finished: boolean;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeScore: number | null;
  awayScore: number | null;
  penaltyWinnerId: number | null;
}

export interface OddsPickIn { phase: string; slot: number; teamId: number | null; }

export interface OddsEntryIn {
  id: number;
  userId: number;
  name: string;
  label: string | null;
  base: number;        // total_score MINUS current knockout points (fixed non-KO part)
  baseCorrect: number; // fixed correct-pick count (group correct), for the tiebreak
  picks: OddsPickIn[];
}

export interface OddsRow {
  id: number;
  userId: number;
  name: string;
  label: string | null;
  winPct: number;      // 0..100
  podiumPct: number;   // 0..100 (finishes in the top 3)
  alive: boolean;      // still has any path to the podium
  clinchedWin: boolean;    // 1st in EVERY remaining future
  clinchedPodium: boolean; // top-3 in EVERY remaining future
  bestRank: number;    // best finishing position across futures
  worstRank: number;   // worst finishing position across futures
}

export interface OddsOutput {
  rows: OddsRow[];
  scenarios: number;  // number of futures evaluated
  remaining: number;  // remaining (undecided) matches
  exact: boolean;     // true = every combination enumerated; false = sampled
}

function finishedWinner(m: OddsMatchIn | undefined): number | null {
  if (!m || !m.finished || m.homeScore == null || m.awayScore == null) return null;
  if (m.homeScore > m.awayScore) return m.homeTeamId;
  if (m.homeScore < m.awayScore) return m.awayTeamId;
  return m.penaltyWinnerId ?? null;
}

const PHASE_ORDER: Phase[] = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];

// Per-entry, precomputed team lists per phase (occupant R32 slots removed), so
// scoring each scenario is a handful of Set lookups.
interface PreppedEntry {
  in: OddsEntryIn;
  r32: number[]; r16: number[]; qf: number[]; sf: number[]; final: number[]; third: number[];
}

function prepEntry(e: OddsEntryIn): PreppedEntry {
  const r32Slots = new Set(e.picks.filter((p) => p.phase === 'r32' && p.teamId != null).map((p) => p.slot));
  const isOccupant = (p: OddsPickIn) => p.phase === 'r32' && p.slot % 2 === 0 && r32Slots.has(p.slot - 1);
  const grab = (phase: string, filter?: (p: OddsPickIn) => boolean) =>
    e.picks.filter((p) => p.phase === phase && p.teamId != null && (!filter || filter(p))).map((p) => p.teamId as number);
  return {
    in: e,
    r32: grab('r32', (p) => !isOccupant(p)),
    r16: grab('r16'), qf: grab('qf'), sf: grab('sf'),
    final: grab('final'), third: grab('3rd'),
  };
}

export function computeKnockoutOdds(
  matchesIn: OddsMatchIn[],
  entries: OddsEntryIn[],
  rules: Record<string, number>,
  opts?: { maxExact?: number; samples?: number }
): OddsOutput {
  const byPhase: Record<Phase, OddsMatchIn[]> = { r32: [], r16: [], qf: [], sf: [], '3rd': [], final: [] };
  for (const m of matchesIn) byPhase[m.phase][m.index] = m;

  // The undecided matches are the free variables. Order is fixed (phase, index).
  const undecided: OddsMatchIn[] = [];
  for (const ph of PHASE_ORDER) for (const m of byPhase[ph]) if (m && !m.finished) undecided.push(m);
  const bitOf = new Map<OddsMatchIn, number>();
  undecided.forEach((m, i) => bitOf.set(m, i));
  const n = undecided.length;

  const rR32 = rules['knockout_r32'] ?? 0, rR16 = rules['knockout_r16'] ?? 0;
  const rQF = rules['knockout_qf'] ?? 0, rSF = rules['knockout_sf'] ?? 0;
  const rFinal = rules['knockout_final'] ?? 0, rWinner = rules['knockout_winner'] ?? 0, rThird = rules['third_place'] ?? 0;

  const maxExact = opts?.maxExact ?? (1 << 16);
  const exact = Math.pow(2, n) <= maxExact;
  const N = exact ? Math.pow(2, n) : (opts?.samples ?? 50000);

  const prepped = entries.map(prepEntry);
  const winCount = new Array(entries.length).fill(0);
  const podiumCount = new Array(entries.length).fill(0);
  const bestRank = new Array(entries.length).fill(Infinity);
  const worstRank = new Array(entries.length).fill(0);

  // Scratch buffers reused across scenarios.
  const scored = new Array(entries.length);

  for (let s = 0; s < N; s++) {
    const bit = (m: OddsMatchIn): number => {
      const j = bitOf.get(m)!;
      return exact ? (s >> j) & 1 : (Math.random() < 0.5 ? 0 : 1);
    };
    const resolve = (m: OddsMatchIn | undefined, pa: number | null, pb: number | null) => {
      if (m && m.finished) { const w = finishedWinner(m); return { winner: w, loser: w === pa ? pb : pa }; }
      if (m) { const b = bit(m); return b === 0 ? { winner: pa, loser: pb } : { winner: pb, loser: pa }; }
      return { winner: pa ?? pb, loser: null };
    };

    const r32w = byPhase.r32.map(finishedWinner);
    const r16w: (number | null)[] = [];
    for (let i = 0; i < 8; i++) r16w[i] = resolve(byPhase.r16[i], r32w[2 * i] ?? null, r32w[2 * i + 1] ?? null).winner;
    const qfw: (number | null)[] = [];
    for (let i = 0; i < 4; i++) qfw[i] = resolve(byPhase.qf[i], r16w[2 * i] ?? null, r16w[2 * i + 1] ?? null).winner;
    const sfRes = [resolve(byPhase.sf[0], qfw[0], qfw[1]), resolve(byPhase.sf[1], qfw[2], qfw[3])];
    const sfw = [sfRes[0].winner, sfRes[1].winner];
    const finalRes = resolve(byPhase.final[0], sfw[0], sfw[1]);
    const thirdRes = resolve(byPhase['3rd'][0], sfRes[0].loser, sfRes[1].loser);

    const w32 = new Set(r32w.filter((x): x is number => x != null));
    const w16 = new Set(r16w.filter((x): x is number => x != null));
    const wqf = new Set(qfw.filter((x): x is number => x != null));
    const wsf = new Set(sfw.filter((x): x is number => x != null));
    const champion = finalRes.winner;
    const finalists = new Set(sfw.filter((x): x is number => x != null));
    const thirdWinner = thirdRes.winner;

    for (let k = 0; k < prepped.length; k++) {
      const pe = prepped[k];
      let pts = pe.in.base, correct = pe.in.baseCorrect;
      for (const t of pe.r32) if (w32.has(t)) { pts += rR32; correct++; }
      for (const t of pe.r16) if (w16.has(t)) { pts += rR16; correct++; }
      for (const t of pe.qf) if (wqf.has(t)) { pts += rQF; correct++; }
      for (const t of pe.sf) if (wsf.has(t)) { pts += rSF; correct++; }
      for (const t of pe.final) {
        if (t === champion) { pts += rFinal + rWinner; correct++; }
        else if (finalists.has(t)) { pts += rFinal; correct++; }
      }
      for (const t of pe.third) if (t === thirdWinner) { pts += rThird; correct++; }
      scored[k] = { k, pts, correct };
    }

    // Rank (competition ranking: 1,2,2,4) by score then correct-count.
    const order = scored.slice().sort((a: any, b: any) => b.pts - a.pts || b.correct - a.correct);
    let rank = 0;
    for (let i = 0; i < order.length; i++) {
      const o = order[i], prev = order[i - 1];
      if (i === 0 || o.pts !== prev.pts || o.correct !== prev.correct) rank = i + 1;
      if (rank === 1) winCount[o.k]++;
      if (rank <= 3) podiumCount[o.k]++;
      if (rank < bestRank[o.k]) bestRank[o.k] = rank;
      if (rank > worstRank[o.k]) worstRank[o.k] = rank;
    }
  }

  const rows: OddsRow[] = entries.map((e, k) => ({
    id: e.id, userId: e.userId, name: e.name, label: e.label,
    winPct: (winCount[k] / N) * 100,
    podiumPct: (podiumCount[k] / N) * 100,
    alive: podiumCount[k] > 0,
    clinchedWin: winCount[k] === N,
    clinchedPodium: podiumCount[k] === N,
    bestRank: bestRank[k] === Infinity ? 0 : bestRank[k],
    worstRank: worstRank[k],
  }));
  // Sort by win chance, then podium chance, then best case.
  rows.sort((a, b) => b.winPct - a.winPct || b.podiumPct - a.podiumPct || a.bestRank - b.bestRank);

  return { rows, scenarios: N, remaining: n, exact };
}
