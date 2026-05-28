import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

const SCORE_CONCURRENCY = 3;

// §3.7 — Bounded-concurrency worker pool. Caps in-flight calculateAllScores
// calls so two concurrent syncs don't pile up dozens of contenders for the
// per-pool advisory lock.
async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = items.slice();
  const runners: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, queue.length); i++) {
    runners.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift()!;
        try { await worker(item); } catch (e) { console.error('[worker]', e); }
      }
    })());
  }
  await Promise.all(runners);
}

// POST /api/admin/sync-scores
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Only global admins can sync live scores
  if (!locals.user.is_admin) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    const result = await syncScores();

    if (result.updated > 0) {
      const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
      const poolIds = pools.map((p: any) => p.id);

      setImmediate(async () => {
        await runWithConcurrency(poolIds, SCORE_CONCURRENCY, async (poolId) => {
          // §3.7 — Re-check is_active before each scoring pass: the pool may
          // have been disabled or deleted while the previous batch was running.
          const { rows: stillActive } = await query(
            'SELECT 1 FROM pools WHERE id = $1 AND is_active = true',
            [poolId]
          );
          if (stillActive.length === 0) return;

          try {
            await calculateAllScores(poolId);
            invalidateCachedPoolLeaderboard(poolId);
            invalidateCachedPoolResults(poolId);
          } catch (e) {
            console.error(`[bg-score] sync-scores pool ${poolId}:`, e);
          }
        });
        invalidateGlobalLeaderboard();
      });
    }

    return json({ ok: true, ...result });
  } catch (e) {
    const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    console.error(`[api/admin/sync-scores] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
