/**
 * Orchestrates the live-score sync: pull results, then rescore every active
 * pool and invalidate caches. Used by the admin "sync now" endpoint and by the
 * background scheduler (hands-off auto-sync).
 */
import { query } from './db.js';
import { syncScores, type SyncResult } from './live-scores.js';
import { calculateAllScores } from './scoring.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from './cache.js';

export async function syncAndRescore(): Promise<SyncResult & { pools: number }> {
  const result = await syncScores();
  let pools = 0;
  if (result.updated > 0) {
    const { rows } = await query('SELECT id FROM pools WHERE is_active = true');
    pools = rows.length;
    for (const p of rows) {
      try {
        await calculateAllScores(p.id);
        invalidateCachedPoolLeaderboard(p.id);
        invalidateCachedPoolResults(p.id);
      } catch (e) {
        console.error(`[sync-runner] rescore pool ${p.id} failed:`, e);
      }
    }
    invalidateGlobalLeaderboard();
  }
  return { ...result, pools };
}

// ── Background scheduler ─────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Start periodic auto-sync. No-op unless AUTO_SYNC_MINUTES > 0 and a provider is
 * configured (API_FOOTBALL_KEY or ENABLE_FIFA_FALLBACK). Safe to call repeatedly
 * (starts at most once per process).
 */
export function startSyncScheduler(): void {
  if (timer) return;
  const minutes = Number(process.env.AUTO_SYNC_MINUTES) || 0;
  if (minutes <= 0) return;
  if (!process.env.API_FOOTBALL_KEY && !process.env.ENABLE_FIFA_FALLBACK) {
    console.warn('[scheduler] AUTO_SYNC_MINUTES set but no provider — auto-sync disabled.');
    return;
  }
  const intervalMs = Math.max(5, minutes) * 60_000; // floor 5 min to respect rate limits

  const tick = async () => {
    if (running) return; // never overlap runs
    running = true;
    try {
      const r = await syncAndRescore();
      if (r.updated > 0) {
        console.log(`[scheduler] synced ${r.updated} match(es), rescored ${r.pools} pool(s).`);
      }
      if (r.unmatched.length > 0) {
        console.warn(`[scheduler] ${r.unmatched.length} unresolved fixture(s): ${r.unmatched.join('; ')}`);
      }
    } catch (e) {
      console.error('[scheduler] auto-sync failed:', e);
    } finally {
      running = false;
    }
  };

  // First run shortly after boot, then on the interval.
  setTimeout(tick, 20_000);
  timer = setInterval(tick, intervalMs);
  console.log(`[scheduler] hands-off auto-sync enabled: every ${Math.max(5, minutes)} min.`);
}
