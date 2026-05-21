import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

// POST /api/admin/sync-scores
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Only global admins can sync live scores
  if (!locals.user.is_admin) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  const result = await syncScores();

  // Async rescoring after sync
  if (result.updated > 0) {
    const pools = db.prepare('SELECT id FROM pools WHERE is_active = 1').all() as any[];
    const poolIds = pools.map(p => p.id);
    setImmediate(() => {
      for (const poolId of poolIds) {
        try {
          calculateAllScores(poolId);
          invalidateCachedPoolLeaderboard(poolId);
          invalidateCachedPoolResults(poolId);
        } catch (e) {
          console.error(`[bg-score] sync-scores pool ${poolId}:`, e);
        }
      }
      invalidateGlobalLeaderboard();
    });
  }

  return json({ ok: true, ...result });
};
