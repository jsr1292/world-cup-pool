import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchLiveTicker, getNextMatch, type TickerMatch, type NextMatch } from '$lib/server/live-scores.js';
import { query } from '$lib/server/db.js';

// Two shared, process-wide caches so the DB/upstream are hit at most once per TTL
// regardless of how many clients are watching:
//   • live matches (FIFA fetch + team-resolution DB reads) — 30s, needs freshness.
//   • next match (a small DB lookup that changes only when a game starts/finishes)
//     — 5 min, so it stops querying the DB every 30s.
let matchesCache: { at: number; data: TickerMatch[] } | null = null;
let matchesInflight: Promise<TickerMatch[]> | null = null;
let nextCache: { at: number; data: NextMatch | null } | null = null;
let nextInflight: Promise<NextMatch | null> | null = null;
const MATCHES_TTL = 30_000;
const NEXT_TTL = 300_000;

function getMatches(): Promise<TickerMatch[]> {
  if (matchesCache && Date.now() - matchesCache.at < MATCHES_TTL) return Promise.resolve(matchesCache.data);
  if (!matchesInflight) {
    matchesInflight = fetchLiveTicker()
      .then((m) => { matchesCache = { at: Date.now(), data: m }; return m; })
      .catch(() => matchesCache?.data ?? [])
      .finally(() => { matchesInflight = null; });
  }
  return matchesInflight;
}
function getNext(): Promise<NextMatch | null> {
  if (nextCache && Date.now() - nextCache.at < NEXT_TTL) return Promise.resolve(nextCache.data);
  if (!nextInflight) {
    nextInflight = getNextMatch()
      .then((n) => { nextCache = { at: Date.now(), data: n }; return n; })
      .catch(() => nextCache?.data ?? null)
      .finally(() => { nextInflight = null; });
  }
  return nextInflight;
}

export const GET: RequestHandler = async ({ locals }) => {
  const [liveMatches, next] = await Promise.all([getMatches(), getNext()]);

  // Per-viewer: attach their own 1/X/2 pick for each live group game (the "tú X"
  // badge). Only runs while a match is live; not cached; response marked private.
  let matches = liveMatches;
  const ids = liveMatches.map((m) => m.match_id).filter((x): x is number => x != null);
  if (locals.user && ids.length > 0) {
    const pickByMatch: Record<number, '1' | 'X' | '2'> = {};
    try {
      const { rows } = await query(
        `SELECT mp.match_id AS mid, mp.home_score AS ph, mp.away_score AS pa
         FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id
         WHERE p.user_id = $1 AND mp.match_id = ANY($2::int[])
           AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL
         ORDER BY p.id`,
        [locals.user.id, ids]
      );
      for (const r of rows) {
        if (pickByMatch[r.mid] === undefined) pickByMatch[r.mid] = r.ph > r.pa ? '1' : r.ph < r.pa ? '2' : 'X';
      }
    } catch { /* no picks → no badge */ }
    matches = liveMatches.map((m) => ({ ...m, my_pick: m.match_id != null ? (pickByMatch[m.match_id] ?? null) : null }));
  }

  return json({ matches, next }, { headers: { 'Cache-Control': 'private, max-age=10' } });
};
