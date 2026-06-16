import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchLiveTicker, getNextMatch, type TickerMatch, type NextMatch } from '$lib/server/live-scores.js';

// Shared, process-wide cache so the upstream FIFA API is polled at most once per
// CACHE_MS no matter how many clients are watching the ticker. A failed fetch
// serves the last good payload rather than flickering to empty.
type Payload = { matches: TickerMatch[]; next: NextMatch | null };
let cache: { at: number; data: Payload } | null = null;
let inflight: Promise<Payload> | null = null;
const CACHE_MS = 30_000;

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return json(cache.data, { headers: { 'Cache-Control': 'public, max-age=20' } });
  }
  // Collapse concurrent refreshes into a single upstream request. The live
  // matches come from FIFA; the "next match" is a cheap local DB lookup, fetched
  // together so the header can show the upcoming game when nothing is live.
  if (!inflight) {
    inflight = Promise.all([fetchLiveTicker(), getNextMatch()])
      .then(([matches, next]): Payload => {
        const data = { matches, next };
        cache = { at: Date.now(), data };
        return data;
      })
      .catch(() => cache?.data ?? { matches: [], next: null })
      .finally(() => { inflight = null; });
  }
  const data = await inflight;
  return json(data, { headers: { 'Cache-Control': 'public, max-age=20' } });
};
