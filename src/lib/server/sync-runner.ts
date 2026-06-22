/**
 * Orchestrates the live-score sync: pull results, then rescore every active
 * pool and invalidate caches. Used by the admin "sync now" endpoint and by the
 * background scheduler (hands-off auto-sync).
 */
import { query } from './db.js';
import { syncScores, type SyncResult } from './live-scores.js';
import { calculateAllScores } from './scoring.js';
import { sendPushToUser, sendPushToUsers, notifyUpcomingMatches, isQuietHours } from './push.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from './cache.js';

/** Each user's BEST (lowest) entry rank in a pool — dense ranking by score. */
async function bestRanksByUser(poolId: number): Promise<Map<number, number>> {
  const { rows } = await query(
    `SELECT user_id, MIN(rnk)::int AS rank FROM (
       SELECT user_id, DENSE_RANK() OVER (ORDER BY total_score DESC) AS rnk
       FROM predictions WHERE pool_id = $1
     ) t GROUP BY user_id`,
    [poolId]
  );
  const m = new Map<number, number>();
  for (const r of rows) m.set(Number(r.user_id), Number(r.rank));
  return m;
}

export async function syncAndRescore(): Promise<SyncResult & { pools: number }> {
  const result = await syncScores();
  let pools = 0;
  if (result.updated > 0) {
    const { rows } = await query('SELECT id, name FROM pools WHERE is_active = true');
    pools = rows.length;
    // Per user, the personalized "you moved" nudge (latest changed pool wins).
    const moved = new Map<number, { title: string; body: string }>();
    for (const p of rows) {
      const before = await bestRanksByUser(p.id);
      try {
        await calculateAllScores(p.id);
        invalidateCachedPoolLeaderboard(p.id);
        invalidateCachedPoolResults(p.id);
      } catch (e) {
        console.error(`[sync-runner] rescore pool ${p.id} failed:`, e);
        continue;
      }
      const after = await bestRanksByUser(p.id);
      for (const [uid, newRank] of after) {
        const oldRank = before.get(uid);
        if (oldRank == null || oldRank === newRank) continue;
        const up = newRank < oldRank;
        moved.set(uid, {
          title: up ? '📈 ¡Has subido!' : '📉 Has bajado',
          body: up
            ? `Ahora vas ${newRank}.º en ${p.name}. ¡Mira la clasificación!`
            : `Ahora vas ${newRank}.º en ${p.name}.`,
        });
      }
    }
    invalidateGlobalLeaderboard();

    // Notify: users whose position changed get the personalized nudge; everyone
    // else with a prediction gets the generic "new results". One shared tag so a
    // user sees a single notification, not a pile. Best-effort. Suppressed during
    // quiet hours (late night) — scores still update, just no buzz.
    if (!isQuietHours()) {
      try {
        for (const [uid, n] of moved) {
          await sendPushToUser(uid, { ...n, url: '/', tag: 'wc-update' });
        }
        const { rows: us } = await query('SELECT DISTINCT user_id FROM predictions');
        const others = us.map((r: any) => Number(r.user_id)).filter((uid: number) => !moved.has(uid));
        await sendPushToUsers(others, {
          title: '⚽ Mundial 2026',
          body: result.updated === 1 ? 'Hay un nuevo resultado — mira cómo vas.' : `${result.updated} resultados nuevos — mira cómo vas.`,
          url: '/',
          tag: 'wc-update',
        });
      } catch (e) {
        console.error('[sync-runner] push notify failed:', e);
      }
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

// Cap on how long we sleep between matches — a safety re-check in case the
// schedule shifts; the compute is suspended the whole time anyway.
const MAX_IDLE_MS = 6 * 60 * 60 * 1000; // 6h

/** How long to wait before the next tick.
 *  - While a fixture is in its active window (kickoff−20min … +3h) → `liveMs`
 *    (poll fast so finals post within ~a minute).
 *  - Otherwise → sleep until ~20 min before the NEXT fixture, clamped to
 *    [liveMs, MAX_IDLE_MS]. This is the key compute saver: between matches and
 *    overnight the scheduler issues one query then sleeps for hours, so Neon's
 *    compute can auto-suspend instead of being woken every few minutes. */
async function nextDelayMs(liveMs: number): Promise<number> {
  try {
    const { rows } = await query(
      `SELECT
         EXISTS (
           SELECT 1 FROM matches
           WHERE kickoff_time IS NOT NULL AND status <> 'finished'
             AND NOW() BETWEEN kickoff_time - INTERVAL '20 minutes'
                           AND kickoff_time + INTERVAL '180 minutes'
         ) AS active,
         (SELECT MIN(kickoff_time) FROM matches
          WHERE kickoff_time IS NOT NULL AND status <> 'finished' AND kickoff_time > NOW()
         ) AS next_kick`
    );
    if (rows[0]?.active) return liveMs;
    const nk = rows[0]?.next_kick ? new Date(rows[0].next_kick).getTime() : null;
    if (nk == null) return MAX_IDLE_MS; // no upcoming fixtures
    const untilActive = nk - 20 * 60_000 - Date.now(); // until 20 min before kickoff
    return Math.max(liveMs, Math.min(untilActive, MAX_IDLE_MS));
  } catch (e) {
    console.error('[scheduler] next-delay check failed:', e);
    return MAX_IDLE_MS;
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
      }
      // Fire "match about to start" reminders (independent of sync success).
      try { await notifyUpcomingMatches(); } catch (e) { console.error('[scheduler] kickoff notify failed:', e); }
      running = false;
    }
    // Re-arm AFTER the run completes (so ticks never overlap): fast while a
    // match is in play, otherwise sleep until just before the next fixture.
    timer = setTimeout(tick, await nextDelayMs(liveMs));
  };

  // First run shortly after boot, then self-schedule adaptively.
  timer = setTimeout(tick, 20_000);
  console.log(
    `[scheduler] auto-sync: ~${Math.round(liveMs / 1000)}s in-match · sleeps until the next fixture otherwise${usingFifa ? '' : ' (API-Football)'}.`
  );
}
