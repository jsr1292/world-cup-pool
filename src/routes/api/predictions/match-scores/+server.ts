import { db } from '$lib/server/db.js';
import { calculateMatchScores, calculateAllScores } from '$lib/server/scoring.js';
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
  const pred = db.prepare('SELECT user_id, pool_id FROM predictions WHERE id = ?').get(prediction_id) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Check deadline (per-phase)
  const poolCheck = db.prepare(
    'SELECT deadline_group, deadline_knockout FROM pools WHERE id = ?'
  ).get(pred.pool_id) as any;

  const matchIds = Object.keys(scores).map(Number);
  if (matchIds.length > 0) {
    const placeholders = matchIds.map(() => '?').join(',');
    const phaseRow = db.prepare(`
      SELECT
        MAX(CASE WHEN phase = 'group' THEN 1 ELSE 0 END) AS has_group,
        MAX(CASE WHEN phase != 'group' THEN 1 ELSE 0 END) AS has_knockout
      FROM matches WHERE id IN (${placeholders})
    `).get(...matchIds) as any;

    const now = new Date();
    if (phaseRow?.has_group && poolCheck?.deadline_group && new Date(poolCheck.deadline_group) <= now) {
      return json({ error: 'La fecha límite de fase de grupos ha pasado' }, { status: 403 });
    }
    if (phaseRow?.has_knockout && poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= now) {
      return json({ error: 'La fecha límite de eliminatorias ha pasado' }, { status: 403 });
    }
  }

  const upsert = db.prepare(`
    INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score)
    VALUES (@prediction_id, @match_id, @home_score, @away_score)
    ON CONFLICT(prediction_id, match_id) DO UPDATE SET
      home_score = @home_score,
      away_score = @away_score,
      points_earned = 0
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM match_predictions WHERE prediction_id = ? AND match_id = ?
  `);

  const saveAll = db.transaction(() => {
    for (const [matchIdStr, score] of Object.entries(scores)) {
      const matchId = Number(matchIdStr);
      const homeRaw = score.home_score;
      const awayRaw = score.away_score;
      const homeScore = (homeRaw !== null && homeRaw !== undefined) ? Number(homeRaw) : null;
      const awayScore = (awayRaw !== null && awayRaw !== undefined) ? Number(awayRaw) : null;

      if (homeScore === null || awayScore === null || isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
        // Delete prediction if scores are null/undefined, NaN, or negative
        deleteStmt.run(prediction_id, matchId);
      } else {
        upsert.run({ prediction_id, match_id: matchId, home_score: homeScore, away_score: awayScore });
      }
    }
  });

  try {
    saveAll();

    // Recalculate scores for this pool
    calculateAllScores(pred.pool_id);

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: 'Error al guardar' }, { status: 500 });
  }
};
