import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchLiveTicker, getNextMatch, type TickerMatch, type NextMatch } from '$lib/server/live-scores.js';
import { query } from '$lib/server/db.js';

// Shared, process-wide cache so the upstream FIFA API is polled at most once per
// CACHE_MS no matter how many clients are watching the ticker. A failed fetch
// serves the last good payload rather than flickering to empty.
type Payload = { matches: TickerMatch[]; next: NextMatch | null };
let cache: { at: number; data: Payload } | null = null;
let inflight: Promise<Payload> | null = null;
const CACHE_MS = 30_000;

export const GET: RequestHandler = async ({ locals }) => {
  const now = Date.now();
  let data: Payload;
  if (cache && now - cache.at < CACHE_MS) {
    data = cache.data;
  } else {
    // Collapse concurrent refreshes into a single upstream request. The live
    // matches come from FIFA; the "next match" is a cheap local DB lookup,
    // fetched together so the header can show the upcoming game when nothing is
    // live. Both are user-agnostic, so they're safe to share across viewers.
    if (!inflight) {
      inflight = Promise.all([fetchLiveTicker(), getNextMatch()])
        .then(([matches, next]): Payload => {
          const fresh = { matches, next };
          cache = { at: Date.now(), data: fresh };
          return fresh;
        })
        .catch(() => cache?.data ?? { matches: [], next: null })
        .finally(() => { inflight = null; });
    }
    data = await inflight;
  }

  // Per-viewer: attach their own 1/X/2 pick for each live group game (so the
  // ticker can show "what I bet"). NOT cached — computed fresh per request, and
  // the response is marked private to keep it out of shared caches.
  let matches = data.matches;
  const ids = data.matches.map((m) => m.match_id).filter((x): x is number => x != null);
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
    matches = data.matches.map((m) => ({ ...m, my_pick: m.match_id != null ? (pickByMatch[m.match_id] ?? null) : null }));
  }

  return json({ matches, next: data.next }, { headers: { 'Cache-Control': 'private, max-age=10' } });
};
