import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
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

  try {
    const result = await syncScores();

    // Async rescoring after sync
    if (result.updated > 0) {
      const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
      const poolIds = pools.map((p: any) => p.id);
      setImmediate(async () => {
        for (const poolId of poolIds) {
          try {
            await calculateAllScores(poolId);
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
  } catch (e) {
    console.error('[api/admin/sync-scores] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
