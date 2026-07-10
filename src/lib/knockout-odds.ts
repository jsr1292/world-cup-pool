// Pure knockout engine. Two uses share ONE implementation of the bracket cascade
// and the scoring rules:
//   • computeKnockoutOdds — enumerates every still-possible future and reports
//     each member's chance to finish 1st / top-3.
//   • resolveTree + scoreEntry — resolve a SINGLE chosen scenario (the
//     interactive "what-if" bracket) and score each member against it.
//
// The bracket cascade is the FIFA 2026 tree (see bracket-2026.ts). DB knockout
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

/** One tie in the resolved tree: the two participants and the (chosen/known) winner. */
export interface TreeSlot { a: number | null; b: number | null; winner: number | null; }

export interface ResolvedTree {
  rounds: { r16: TreeSlot[]; qf: TreeSlot[]; sf: TreeSlot[]; final: TreeSlot; third: TreeSlot };
  pw: Record<Phase, Set<number>>; // teams that win a match in each phase
  finalists: Set<number>;
}

function finishedWinner(m: OddsMatchIn | undefined): number | null {
  if (!m || !m.finished || m.homeScore == null || m.awayScore == null) return null;
  if (m.homeScore > m.awayScore) return m.homeTeamId;
  if (m.homeScore < m.awayScore) return m.awayTeamId;
  return m.penaltyWinnerId ?? null;
}

const PHASE_ORDER: Phase[] = ['r32', 'r16', 'qf', 'sf', 'final', '3rd'];

export function groupByPhase(matches: OddsMatchIn[]): Record<Phase, OddsMatchIn[]> {
  const byPhase: Record<Phase, OddsMatchIn[]> = { r32: [], r16: [], qf: [], sf: [], '3rd': [], final: [] };
  for (const m of matches) byPhase[m.phase][m.index] = m;
  return byPhase;
}

/** The undecided matches (free variables), in a stable (phase, index) order. */
export function undecidedMatches(byPhase: Record<Phase, OddsMatchIn[]>): OddsMatchIn[] {
  const out: OddsMatchIn[] = [];
  for (const ph of PHASE_ORDER) for (const m of byPhase[ph]) if (m && !m.finished) out.push(m);
  return out;
}

/**
 * Resolve the whole knockout tree. `choose(match, a, b)` decides the winner of an
 * UNDECIDED match given its two participants (return null = not yet decided);
 * finished matches use their real result. Returns the per-round matchups (for
 * rendering) plus the phase-winner sets (for scoring).
 */
export function resolveTree(
  byPhase: Record<Phase, OddsMatchIn[]>,
  choose: (m: OddsMatchIn, a: number | null, b: number | null) => number | null,
  r32Participants?: { a: number | null; b: number | null }[]
): ResolvedTree {
  const pick = (m: OddsMatchIn | undefined, a: number | null, b: number | null): { winner: number | null; loser: number | null } => {
    if (m && m.finished) { const w = finishedWinner(m); return { winner: w, loser: w === a ? b : a }; }
    if (!m) return { winner: a ?? b, loser: null };
    const w = choose(m, a, b);
    return { winner: w, loser: w == null ? null : (w === a ? b : a) };
  };

  // R32 is the only round whose participants come from OUTSIDE the KO tree (group
  // results). If r32Participants is supplied (unified sim), use it and let R32 be
  // picked; otherwise fall back to each DB r32 row's own teams (odds path: those
  // rows are finished, so pick() returns the real winner and choose is never hit).
  const r32Slots: TreeSlot[] = [];
  const r32w: (number | null)[] = [];
  for (let i = 0; i < 16; i++) {
    const m = byPhase.r32?.[i];
    const ext = r32Participants?.[i];
    const a = m && m.finished ? m.homeTeamId : (ext ? ext.a : (m?.homeTeamId ?? null));
    const b = m && m.finished ? m.awayTeamId : (ext ? ext.b : (m?.awayTeamId ?? null));
    const w = pick(m, a, b).winner;
    r32Slots.push({ a, b, winner: w });
    r32w.push(w);
  }

  const r16: TreeSlot[] = [];
  for (let i = 0; i < 8; i++) {
    const a = r32w[2 * i] ?? null, b = r32w[2 * i + 1] ?? null;
    r16.push({ a, b, winner: pick(byPhase.r16?.[i], a, b).winner });
  }
  const qf: TreeSlot[] = [];
  for (let i = 0; i < 4; i++) {
    const a = r16[2 * i].winner, b = r16[2 * i + 1].winner;
    qf.push({ a, b, winner: pick(byPhase.qf?.[i], a, b).winner });
  }
  const sf: TreeSlot[] = [];
  const sfLose: (number | null)[] = [];
  for (let i = 0; i < 2; i++) {
    const a = qf[2 * i].winner, b = qf[2 * i + 1].winner;
    const r = pick(byPhase.sf?.[i], a, b);
    sf.push({ a, b, winner: r.winner }); sfLose.push(r.loser);
  }
  const fr = pick(byPhase.final?.[0], sf[0].winner, sf[1].winner);
  const final: TreeSlot = { a: sf[0].winner, b: sf[1].winner, winner: fr.winner };
  const tr = pick(byPhase['3rd']?.[0], sfLose[0], sfLose[1]);
  const third: TreeSlot = { a: sfLose[0], b: sfLose[1], winner: tr.winner };

  const S = (arr: (number | null)[]) => new Set(arr.filter((x): x is number => x != null));
  const pw: Record<Phase, Set<number>> = {
    r32: S(r32w), r16: S(r16.map((s) => s.winner)), qf: S(qf.map((s) => s.winner)),
    sf: S(sf.map((s) => s.winner)), final: S([final.winner]), '3rd': S([third.winner]),
  };
  // The "reached the final" consolation (a correctly-picked losing finalist earns
  // knockout_final) only applies once the final is DECIDED — matching the server
  // scorer, whose finalists come from finished final matches. So a what-if with
  // the final not yet chosen credits neither finalist, and a zero-pick projection
  // equals the live standings.
  const finalists = final.winner != null ? S([sf[0].winner, sf[1].winner]) : new Set<number>();
  return { rounds: { r16, qf, sf, final, third }, pw, finalists };
}

// Per-entry, precomputed team lists per phase (occupant R32 slots removed), so
// scoring is a handful of Set lookups.
export interface PreppedEntry {
  in: OddsEntryIn;
  r32: number[]; r16: number[]; qf: number[]; sf: number[]; final: number[]; third: number[];
}

export function prepEntry(e: OddsEntryIn): PreppedEntry {
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

/** Score one prepped entry against a resolved tree. Returns points + correct count. */
export function scoreEntry(pe: PreppedEntry, tree: ResolvedTree, rules: Record<string, number>): { pts: number; correct: number } {
  let pts = pe.in.base, correct = pe.in.baseCorrect;
  const { pw, finalists } = tree;
  const champion = tree.rounds.final.winner;
  const thirdWinner = tree.rounds.third.winner;
  for (const t of pe.r32) if (pw.r32.has(t)) { pts += rules['knockout_r32'] ?? 0; correct++; }
  for (const t of pe.r16) if (pw.r16.has(t)) { pts += rules['knockout_r16'] ?? 0; correct++; }
  for (const t of pe.qf) if (pw.qf.has(t)) { pts += rules['knockout_qf'] ?? 0; correct++; }
  for (const t of pe.sf) if (pw.sf.has(t)) { pts += rules['knockout_sf'] ?? 0; correct++; }
  for (const t of pe.final) {
    if (t === champion) { pts += (rules['knockout_final'] ?? 0) + (rules['knockout_winner'] ?? 0); correct++; }
    else if (finalists.has(t)) { pts += rules['knockout_final'] ?? 0; correct++; }
  }
  for (const t of pe.third) if (t === thirdWinner) { pts += rules['third_place'] ?? 0; correct++; }
  return { pts, correct };
}

export function computeKnockoutOdds(
  matchesIn: OddsMatchIn[],
  entries: OddsEntryIn[],
  rules: Record<string, number>,
  opts?: { maxExact?: number; samples?: number }
): OddsOutput {
  const byPhase = groupByPhase(matchesIn);
  const undecided = undecidedMatches(byPhase);
  const bitOf = new Map<OddsMatchIn, number>();
  undecided.forEach((m, i) => bitOf.set(m, i));
  const n = undecided.length;

  const maxExact = opts?.maxExact ?? (1 << 16);
  const exact = Math.pow(2, n) <= maxExact;
  const N = exact ? Math.pow(2, n) : (opts?.samples ?? 50000);

  const prepped = entries.map(prepEntry);
  const winCount = new Array(entries.length).fill(0);
  const podiumCount = new Array(entries.length).fill(0);
  const bestRank = new Array(entries.length).fill(Infinity);
  const worstRank = new Array(entries.length).fill(0);
  const scored = new Array(entries.length);

  for (let s = 0; s < N; s++) {
    const choose = (m: OddsMatchIn, a: number | null, b: number | null): number | null => {
      const j = bitOf.get(m)!;
      const bit = exact ? (s >> j) & 1 : (Math.random() < 0.5 ? 0 : 1);
      return bit === 0 ? a : b;
    };
    const tree = resolveTree(byPhase, choose);

    for (let k = 0; k < prepped.length; k++) {
      const { pts, correct } = scoreEntry(prepped[k], tree, rules);
      scored[k] = { k, pts, correct };
    }

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
  rows.sort((a, b) => b.winPct - a.winPct || b.podiumPct - a.podiumPct || a.bestRank - b.bestRank);

  return { rows, scenarios: N, remaining: n, exact };
}
