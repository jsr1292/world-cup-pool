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
export interface StakesResponse {
  /** Names guaranteed to win (or share) 1st no matter what; null if still open. */
  champions: string[] | null;
  matches: StakesMatch[];
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
  opts?: { maxExact?: number },
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

  let globalInter: Set<number> | undefined;
  const homeInter: (Set<number> | undefined)[] = undecided.map(() => undefined);
  const awayInter: (Set<number> | undefined)[] = undecided.map(() => undefined);
  // Participants (a,b) a match is played between are fixed only when its feeders
  // are all decided — track whether they stay constant across every outcome.
  const part: ({ a: number | null; b: number | null; fixed: boolean } | null)[] = undecided.map(() => null);

  const scored: { k: number; pts: number; correct: number }[] = new Array(entries.length);

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
    // Rank-1 set for this outcome (ties share rank 1), mirroring the odds engine's
    // sort: points first, correct-pick count as tiebreak.
    const order = scored.slice().sort((a, b) => b.pts - a.pts || b.correct - a.correct);
    const top = order[0];
    const winners: number[] = [];
    for (const o of order) {
      if (o.pts === top.pts && o.correct === top.correct) winners.push(entries[o.k].id);
      else break;
    }

    globalInter = intersect(globalInter, winners);
    for (let j = 0; j < n; j++) {
      const c = cap[j];
      if (c) {
        const p = part[j];
        if (p == null) part[j] = { a: c.a, b: c.b, fixed: true };
        else if (p.a !== c.a || p.b !== c.b) p.fixed = false;
      }
      if (((s >> j) & 1) === 0) homeInter[j] = intersect(homeInter[j], winners);
      else awayInter[j] = intersect(awayInter[j], winners);
    }
  }

  // Names in entries order (which is total_score desc), so a shared-lead reads
  // naturally.
  const namesOf = (set: Set<number> | undefined): string[] | null =>
    set && set.size ? entries.filter((e) => set.has(e.id)).map((e) => e.name) : null;

  const champions = namesOf(globalInter);

  const matches: StakesMatch[] = [];
  undecided.forEach((m, j) => {
    const p = part[j];
    if (!p || !p.fixed || p.a == null || p.b == null) return; // participants not fixed yet
    const wHome = namesOf(homeInter[j]);
    const wAway = namesOf(awayInter[j]);
    if (!wHome && !wAway) return; // neither result decides it
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

  return { champions, matches };
}
