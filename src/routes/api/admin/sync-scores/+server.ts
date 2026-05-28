import { errCode } from '$lib/server/err-code.js';
import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { runWithConcurrency } from '$lib/server/concurrency.js';

const SCORE_CONCURRENCY = 3;

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

      await runWithConcurrency(poolIds, SCORE_CONCURRENCY, async (poolId) => {
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
          console.error(`[score] sync-scores pool ${poolId}:`, e);
        }
      });
      invalidateGlobalLeaderboard();
    }

    return json({ ok: true, ...result });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/sync-scores] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
