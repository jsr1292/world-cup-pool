import { query } from '$lib/server/db.js';
import { calculateMatchScores, calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

// POST /api/predictions/match-scores
// Body: { prediction_id, scores: { [matchId]: { home_score, away_score }, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { prediction_id, scores } = body as {
    prediction_id: number;
    scores: Record<string, { home_score: number; away_score: number }>;
  };

  if (!prediction_id || !scores) {
    return json({ error: 'Falta prediction_id o scores' }, { status: 400 });
  }

  // Verify ownership
  const { rows: predRows } = await query('SELECT user_id, pool_id FROM predictions WHERE id = $1', [prediction_id]);
  const pred = predRows[0] ?? null;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Check deadline (per-phase)
  const { rows: poolRows } = await query(
    'SELECT deadline_group, deadline_knockout FROM pools WHERE id = $1',
    [pred.pool_id]
  );
  const poolCheck = poolRows[0] ?? null;

  const matchIds = Object.keys(scores).map(Number);
  if (matchIds.length > 0) {
    const placeholders = matchIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows: phaseRows } = await query(`
      SELECT
        MAX(CASE WHEN phase = 'group' THEN 1 ELSE 0 END) AS has_group,
        MAX(CASE WHEN phase != 'group' THEN 1 ELSE 0 END) AS has_knockout
      FROM matches WHERE id IN (${placeholders})
    `, matchIds);
    const phaseRow = phaseRows[0] ?? null;

    const now = new Date();
    if (phaseRow?.has_group && poolCheck?.deadline_group && new Date(poolCheck.deadline_group) <= now) {
      return json({ error: 'La fecha límite de fase de grupos ha pasado' }, { status: 403 });
    }
    if (phaseRow?.has_knockout && poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= now) {
      return json({ error: 'La fecha límite de eliminatorias ha pasado' }, { status: 403 });
    }
  }

  try {
    for (const [matchIdStr, score] of Object.entries(scores)) {
      const matchId = Number(matchIdStr);
      const homeRaw = score.home_score;
      const awayRaw = score.away_score;
      const homeScore = (homeRaw !== null && homeRaw !== undefined) ? Number(homeRaw) : null;
      const awayScore = (awayRaw !== null && awayRaw !== undefined) ? Number(awayRaw) : null;

      if (homeScore === null || awayScore === null || isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
        // Delete prediction if scores are null/undefined, NaN, or negative
        await query('DELETE FROM match_predictions WHERE prediction_id = $1 AND match_id = $2', [prediction_id, matchId]);
      } else {
        await query(`
          INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT(prediction_id, match_id) DO UPDATE SET
            home_score = $3,
            away_score = $4,
            points_earned = 0
        `, [prediction_id, matchId, homeScore, awayScore]);
      }
    }

    // Async scoring — respond immediately, score in background
    const poolId = pred.pool_id;
    setImmediate(async () => {
      try {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
        invalidateGlobalLeaderboard();
      } catch (e) {
        console.error('[bg-score] match-scores pool', poolId, e);
      }
    });

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Error al guardar' }, { status: 500 });
  }
};
