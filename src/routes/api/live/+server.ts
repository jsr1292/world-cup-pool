import { json, type RequestHandler } from '@sveltejs/kit';
import { fetchLiveTicker, type TickerMatch } from '$lib/server/live-scores.js';

// Shared, process-wide cache so the upstream FIFA API is polled at most once per
// CACHE_MS no matter how many clients are watching the ticker. A failed fetch
// serves the last good payload rather than flickering to empty.
let cache: { at: number; data: TickerMatch[] } | null = null;
let inflight: Promise<TickerMatch[]> | null = null;
const CACHE_MS = 30_000;

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return json({ matches: cache.data }, { headers: { 'Cache-Control': 'public, max-age=20' } });
  }
  // Collapse concurrent refreshes into a single upstream request.
  if (!inflight) {
    inflight = fetchLiveTicker()
      .then((data) => { cache = { at: Date.now(), data }; return data; })
      .catch(() => cache?.data ?? [])
      .finally(() => { inflight = null; });
  }
  const data = await inflight;
  return json({ matches: data }, { headers: { 'Cache-Control': 'public, max-age=20' } });
};
