// "Qué se juega" — end-of-tournament CERTAINTIES, derived from the same exact
// enumeration the odds engine uses. Two kinds of certainty:
//   • champions — someone finishes #1 in EVERY still-possible outcome (the pool
//     is already decided);
//   • per-match — for an upcoming match whose two participants are fixed, one or
//     both results forces a definite pool winner ("si gana Francia → Juan").
// Certainties require EXHAUSTIVE enumeration, so this returns null unless the
// remaining outcomes are few enough to enumerate exactly (never guesses from a
// Monte-Carlo sample).
import {
  groupByPhase, undecidedMatches, resolveTree, prepEntry, scoreEntry,
  type OddsMatchIn, type OddsEntryIn,
} from './knockout-odds.js';
import { computePrizes } from './prizes.js';

export interface StakesTeam { name: string; flag: string }
export interface StakesMatch {
  id: number;
  phase: string;
  kickoff: string | null;
  home: StakesTeam;
  away: StakesTeam;
  /** Pool winner(s) if `home` wins this match; null if that result leaves it open. */
  winnersIfHome: string[] | null;
  winnersIfAway: string[] | null;
}
export interface StakesPodiumRow {
  /** Dense rank: 1 | 2 | 3. */
  position: number;
  /** Display order within a tie (entries order = total_score desc). */
  names: string[];
  /** null = not invariant across futures, or a free pool. */
  prize: number | null;
}
export interface StakesResponse {
  /** Names guaranteed 1st no matter what; null if still open. Projection of `podium`. */
  champions: string[] | null;
  /** Settled podium positions only. May be empty or partial. */
  podium: StakesPodiumRow[];
  matches: StakesMatch[];
}

/** One entry's score in one future. */
interface Scored { k: number; pts: number; correct: number }

/**
 * The leaderboard's ranking, exactly: sort by points desc (correct-pick count
 * only orders DISPLAY within a tie), then DENSE-rank by points alone, so entries
 * level on points share a position. Mirrors leaderboardRanks in
 * routes/pool/[id]/+page.svelte and computeUnifiedProjection in sim-projection.ts
 * — aciertos is NOT a position tiebreak.
 */
function rankBoard(scored: Scored[]): { k: number; pts: number; rank: number }[] {
  const order = scored.slice().sort((a, b) => b.pts - a.pts || b.correct - a.correct);
  let rank = 0;
  let prev: number | null = null;
  return order.map((o) => {
    if (prev === null || o.pts !== prev) { rank += 1; prev = o.pts; }
    return { k: o.k, pts: o.pts, rank };
  });
}

/**
 * @param matchesIn  knockout template rows (r32..final), same shape as the odds engine
 * @param entries    per-entry base score + picks, same shape as the odds engine
 * @param rules      scoring rules
 * @param meta       parallel to matchesIn: db match id + kickoff for display
 * @param team       resolve a team id to {name, flag}
 */
export function computeStakes(
  matchesIn: OddsMatchIn[],
  entries: OddsEntryIn[],
  rules: Record<string, number>,
  meta: { id: number; kickoff: string | null }[],
  team: (id: number) => StakesTeam,
  opts?: { maxExact?: number; pot?: number },
): StakesResponse | null {
  const byPhase = groupByPhase(matchesIn);
  const undecided = undecidedMatches(byPhase);
  const n = undecided.length;
  const maxExact = opts?.maxExact ?? (1 << 16);
  // Nothing left to decide, or too many outcomes to enumerate exactly → no
  // certainties we can prove.
  if (n === 0 || Math.pow(2, n) > maxExact) return null;

  const metaOf = new Map<OddsMatchIn, { id: number; kickoff: string | null }>();
  matchesIn.forEach((m, i) => metaOf.set(m, meta[i]));
  const bitOf = new Map<OddsMatchIn, number>();
  undecided.forEach((m, i) => bitOf.set(m, i));

  const prepped = entries.map(prepEntry);
  const N = Math.pow(2, n);

  const intersect = (cur: Set<number> | undefined, next: number[]): Set<number> => {
    if (cur === undefined) return new Set(next);
    const r = new Set<number>();
    for (const x of next) if (cur.has(x)) r.add(x);
    return r;
  };

  const homeInter: (Set<number> | undefined)[] = undecided.map(() => undefined);
  const awayInter: (Set<number> | undefined)[] = undecided.map(() => undefined);
  // Per-branch winners need the SAME set-identity treatment as the podium:
  // intersection alone can turn a future where the leader is alone 1st and
  // another where they're tied 1st into a false "always wins outright". Track
  // a canonical sorted-id key per (side, match) and only trust the intersection
  // when every future on that side agrees on it exactly.
  const bKey: (string | undefined)[][] = [undecided.map(() => undefined), undecided.map(() => undefined)];
  const bOk: boolean[][] = [undecided.map(() => true), undecided.map(() => true)];
  // Participants (a,b) a match is played between are fixed only when its feeders
  // are all decided — track whether they stay constant across every outcome.
  const part: ({ a: number | null; b: number | null; fixed: boolean } | null)[] = undecided.map(() => null);

  // Podium: position p (1..3) is settled iff its occupant SET is identical in
  // EVERY future. Canonicalise each future's set as a sorted-id key and compare.
  // Deliberately NOT an intersection: an entry alone 1st in one future and tied
  // 1st in another has NOT settled 1st — they would split the pot.
  const posKey: (string | undefined)[] = [undefined, undefined, undefined];
  const posIds: number[][] = [[], [], []];
  const posSettled: boolean[] = [true, true, true];

  // Prize invariance is tracked SEPARATELY from whether a position is settled.
  // computePrizes assigns by FINISHING PLACE (array index), while the board
  // displays DENSE rank — so a tie above an entry changes its place, and its
  // money, while its displayed position stays put.
  const pot = opts?.pot ?? 0;
  const idxById = new Map<number, number>();
  entries.forEach((e, k) => idxById.set(e.id, k));
  const prizeFirst: (number | undefined)[] = new Array(entries.length).fill(undefined);
  const prizeVaries: boolean[] = new Array(entries.length).fill(false);

  const scored: Scored[] = new Array(entries.length);

  for (let s = 0; s < N; s++) {
    const cap: (({ a: number | null; b: number | null }) | undefined)[] = new Array(n);
    const choose = (m: OddsMatchIn, a: number | null, b: number | null): number | null => {
      const j = bitOf.get(m)!;
      cap[j] = { a, b };
      return ((s >> j) & 1) === 0 ? a : b;
    };
    const tree = resolveTree(byPhase, choose);

    for (let k = 0; k < prepped.length; k++) {
      const { pts, correct } = scoreEntry(prepped[k], tree, rules);
      scored[k] = { k, pts, correct };
    }
    const ranked = rankBoard(scored);
    const winners = ranked.filter((r) => r.rank === 1).map((r) => entries[r.k].id);

    for (let p = 1; p <= 3; p++) {
      const ids = ranked.filter((r) => r.rank === p).map((r) => entries[r.k].id).sort((a, b) => a - b);
      const key = ids.join(',');
      if (posKey[p - 1] === undefined) { posKey[p - 1] = key; posIds[p - 1] = ids; }
      else if (posKey[p - 1] !== key) posSettled[p - 1] = false;
    }

    // `ranked` is already sorted points-desc with ties adjacent, which is exactly
    // what computePrizes requires.
    if (pot > 0) {
      const prizes = computePrizes(ranked.map((r) => r.pts), pot);
      for (let i = 0; i < ranked.length; i++) {
        const k = ranked[i].k;
        if (prizeFirst[k] === undefined) prizeFirst[k] = prizes[i];
        else if (prizeFirst[k] !== prizes[i]) prizeVaries[k] = true;
      }
    }

    for (let j = 0; j < n; j++) {
      const c = cap[j];
      if (c) {
        const p = part[j];
        if (p == null) part[j] = { a: c.a, b: c.b, fixed: true };
        else if (p.a !== c.a || p.b !== c.b) p.fixed = false;
      }
      const side = ((s >> j) & 1) === 0 ? 0 : 1;
      const wkey = winners.slice().sort((a, b) => a - b).join(',');
      if (bKey[side][j] === undefined) bKey[side][j] = wkey;
      else if (bKey[side][j] !== wkey) bOk[side][j] = false;
      if (side === 0) homeInter[j] = intersect(homeInter[j], winners);
      else awayInter[j] = intersect(awayInter[j], winners);
    }
  }

  // Names in entries order (which is total_score desc), so a shared-lead reads
  // naturally.
  const namesOf = (set: Set<number> | undefined): string[] | null =>
    set && set.size ? entries.filter((e) => set.has(e.id)).map((e) => e.name) : null;

  const rowPrize = (ids: number[]): number | null => {
    if (pot <= 0) return null;
    let v: number | null = null;
    for (const id of ids) {
      const k = idxById.get(id)!;
      if (prizeVaries[k]) return null;
      const p = prizeFirst[k];
      if (p === undefined) return null;
      if (v === null) v = p;
      else if (v !== p) return null; // tied members should share equally; belt and braces
    }
    return v;
  };

  const podium: StakesPodiumRow[] = [];
  for (let p = 1; p <= 3; p++) {
    if (!posSettled[p - 1]) continue;
    const ids = posIds[p - 1];
    if (ids.length === 0) continue; // position doesn't exist (pool smaller than 3)
    podium.push({ position: p, names: namesOf(new Set(ids))!, prize: rowPrize(ids) });
  }
  // ONE source of truth: champions is a projection of the podium, so the two can
  // never disagree.
  const champions = podium.find((r) => r.position === 1)?.names ?? null;

  const matches: StakesMatch[] = [];
  undecided.forEach((m, j) => {
    const p = part[j];
    if (!p || !p.fixed || p.a == null || p.b == null) return; // participants not fixed yet
    const wHome = bOk[0][j] ? namesOf(homeInter[j]) : null;
    const wAway = bOk[1][j] ? namesOf(awayInter[j]) : null;
    if (!wHome && !wAway) return; // neither result decides it
    // winnersIfHome/winnersIfAway use the intersection ONLY when bOk confirms
    // set-identity held across every future on that side — same guarantee
    // champions/podium give, applied per branch instead of globally. A branch
    // that mixes an outright win with a tie is suppressed (null), not
    // reported as an intersection of the two.
    const md = metaOf.get(m);
    matches.push({
      id: md?.id ?? 0,
      phase: m.phase,
      kickoff: md?.kickoff ?? null,
      home: team(p.a),
      away: team(p.b),
      winnersIfHome: wHome,
      winnersIfAway: wAway,
    });
  });
  matches.sort((a, b) => (a.kickoff ?? '').localeCompare(b.kickoff ?? ''));

  return { champions, podium, matches };
}
