import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';

// POST /api/admin/results
// Body: { match_id, home_score, away_score }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { match_id, home_score, away_score, penalty_winner_id = null } = await request.json() as {
      match_id: number; home_score: number; away_score: number; penalty_winner_id?: number | null;
    };

    if (match_id == null || home_score == null || away_score == null) {
      return json({ error: 'Faltan campos' }, { status: 400 });
    }

    if (
      !Number.isInteger(home_score) || !Number.isInteger(away_score) ||
      home_score < 0 || away_score < 0 ||
      home_score > 30 || away_score > 30
    ) {
      return json({ error: 'Marcador inválido' }, { status: 400 });
    }

    // Verify user is admin
    const { rows: actorRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const actor = actorRows[0] ?? null;
    if (!actor?.is_admin) {
      return json({ error: 'Solo los administradores pueden modificar resultados' }, { status: 403 });
    }

    // Get match
    const { rows: matchRows } = await query('SELECT * FROM matches WHERE id = $1', [match_id]);
    const match = matchRows[0] ?? null;
    if (!match) return json({ error: 'Partido no encontrado' }, { status: 404 });

    // Update match result (penalty_winner_id is NULL for normal wins, set for penalty shootout deciders)
    await query(
      "UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
      [home_score, away_score, match_id, penalty_winner_id]
    );

    await logAudit('update_result', locals.user.id, 'match', match_id, { home_score: match.home_score, away_score: match.away_score }, { home_score, away_score });

    // Async rescoring — respond immediately, score all pools in background
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    const poolIds = pools.map((p: any) => p.id);

    setImmediate(async () => {
      for (const poolId of poolIds) {
        try {
          await calculateAllScores(poolId);
          invalidateCachedPoolLeaderboard(poolId);
          invalidateCachedPoolResults(poolId);
        } catch (e) {
          console.error(`[bg-score] admin/results pool ${poolId}:`, e);
        }
      }
      invalidateGlobalLeaderboard();
    });

    return json({ ok: true, scoring: 'pending' });
  } catch (e) {
    console.error('[api/admin/results] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
