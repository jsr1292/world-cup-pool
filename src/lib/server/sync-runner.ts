/**
 * Orchestrates the live-score sync: pull results, then rescore every active
 * pool and invalidate caches. Used by the admin "sync now" endpoint and by the
 * background scheduler (hands-off auto-sync).
 */
import { query } from './db.js';
import { syncScores, type SyncResult } from './live-scores.js';
import { calculateAllScores } from './scoring.js';
import { sendPushToUsers } from './push.js';
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

    // Nudge opted-in users back into the app. Collapses via the 'results' tag so
    // a string of finishes shows one notification, not a pile. Best-effort.
    try {
      const { rows: us } = await query('SELECT DISTINCT user_id FROM predictions');
      await sendPushToUsers(us.map((r: any) => Number(r.user_id)), {
        title: '⚽ Mundial 2026',
        body: result.updated === 1 ? 'Hay un nuevo resultado — mira cómo vas.' : `${result.updated} resultados nuevos — mira cómo vas.`,
        url: '/',
        tag: 'results',
      });
    } catch (e) {
      console.error('[sync-runner] push notify failed:', e);
    }
  }
  // Record this run for the admin sync-health indicator (best-effort).
  try {
    await query(
      `INSERT INTO site_settings (key, value) VALUES ('last_sync', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({
        at: new Date().toISOString(),
        updated: result.updated,
        pools,
        unmatched: result.unmatched.length,
        errors: result.errors,
      })]
    );
  } catch (e) {
    console.error('[sync-runner] could not record last_sync:', e);
  }
  return { ...result, pools };
}

// ── Background scheduler ─────────────────────────────────────────────────────
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** True if any fixture is within its play window (kickoff−5min … kickoff+3h)
 *  and not yet recorded finished — i.e. a result could land imminently. */
async function anyMatchInPlayWindow(): Promise<boolean> {
  try {
    const { rows } = await query(
      `SELECT 1 FROM matches
         WHERE kickoff_time IS NOT NULL AND status <> 'finished'
           AND NOW() BETWEEN kickoff_time - INTERVAL '5 minutes'
                         AND kickoff_time + INTERVAL '180 minutes'
         LIMIT 1`
    );
    return rows.length > 0;
  } catch (e) {
    console.error('[scheduler] live-window check failed:', e);
    return false;
  }
}

/**
 * Start adaptive auto-sync. No-op unless AUTO_SYNC_MINUTES > 0 and a provider is
 * configured. Safe to call repeatedly (starts at most once per process).
 *
 * Cadence adapts to the schedule: while a match could be in play we poll every
 * ~90s so a final score (and the rescored standings) lands within about a minute
 * of full-time; between matches we fall back to the configured idle gap. Since
 * syncScores only WRITES finished matches, the frequent in-window polls are
 * cheap fetches that trigger a rescore only when a game actually ends.
 *
 * The fast cadence is gated to the keyless FIFA source — API-Football's free
 * tier (100 req/day) can't sustain it, so with a key set it stays at the idle
 * gap. Override the in-match cadence with AUTO_SYNC_LIVE_SECONDS (min 45s).
 */
export function startSyncScheduler(): void {
  if (timer) return;
  const minutes = Number(process.env.AUTO_SYNC_MINUTES) || 0;
  if (minutes <= 0) return;
  // The keyless FIFA source is the default fallback, so a provider is always
  // available unless it was explicitly disabled without an API key.
  if (!process.env.API_FOOTBALL_KEY && process.env.DISABLE_FIFA_FALLBACK) {
    console.warn('[scheduler] AUTO_SYNC_MINUTES set but no provider — auto-sync disabled.');
    return;
  }

  const usingFifa = !process.env.API_FOOTBALL_KEY; // FIFA fallback: free, no quota
  const idleMs = Math.max(5, minutes) * 60_000;    // floor 5 min between matches
  const liveMs = usingFifa
    ? Math.max(45, Number(process.env.AUTO_SYNC_LIVE_SECONDS) || 90) * 1000
    : idleMs; // API-Football: no aggressive polling (protect the daily quota)

  const tick = async () => {
    if (!running) {
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
    }
    // Re-arm AFTER the run completes (so ticks never overlap): fast while a
    // match is in its play window, otherwise the idle gap.
    const fast = liveMs < idleMs && (await anyMatchInPlayWindow());
    timer = setTimeout(tick, fast ? liveMs : idleMs);
  };

  // First run shortly after boot, then self-schedule adaptively.
  timer = setTimeout(tick, 20_000);
  console.log(
    `[scheduler] adaptive auto-sync: ~${Math.round(liveMs / 1000)}s in-match · ${Math.max(5, minutes)} min idle${usingFifa ? '' : ' (API-Football: fixed)'}.`
  );
}
