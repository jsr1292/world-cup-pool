import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
import { runWithConcurrency } from '$lib/server/concurrency.js';

// POST /api/admin/reset-results
// Restore ALL matches to their pristine (post-seed) state: group matches keep
// their teams but lose scores/status; knockout matches go back to empty
// placeholders. Then rescore every pool (everything returns to 0). Site-admin
// only. Useful to clear test data before the tournament — no SQL needed.
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const { rows: actorRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
  if (!actorRows[0]?.is_admin) {
    return json({ error: 'Solo los administradores pueden reiniciar resultados' }, { status: 403 });
  }

  try {
    // Group matches keep their seeded teams; just clear the result.
    const g = await query(
      `UPDATE matches
         SET home_score = NULL, away_score = NULL, penalty_winner_id = NULL, status = 'scheduled'
       WHERE phase = 'group'`
    );
    // Knockout matches go back to empty placeholders (teams unknown again).
    const k = await query(
      `UPDATE matches
         SET home_team_id = NULL, away_team_id = NULL, home_score = NULL, away_score = NULL,
             penalty_winner_id = NULL, status = 'scheduled', fifa_id = NULL
       WHERE phase <> 'group'`
    );

    await logAudit('reset_results', locals.user.id, 'matches', 0, {}, {
      group_reset: g.rowCount ?? 0, knockout_reset: k.rowCount ?? 0,
    });

    // Rescore every active pool so totals return to 0.
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    await runWithConcurrency(pools.map((p: any) => p.id), 3, async (poolId) => {
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
      } catch (e) {
        console.error(`[reset-results] rescore pool ${poolId}:`, e);
      }
    });
    invalidateGlobalLeaderboard();

    return json({ ok: true, group_reset: g.rowCount ?? 0, knockout_reset: k.rowCount ?? 0 });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/reset-results] ${code}:`, e);
    return json({ error: 'Error al reiniciar resultados', code }, { status: 500 });
  }
};
