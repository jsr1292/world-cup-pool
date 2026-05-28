import { query, getClient } from '$lib/server/db.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

// POST /api/predictions/match-scores
// Body: { prediction_id, scores: { [matchId]: { home_score, away_score }, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { prediction_id, scores } = body as {
    prediction_id: number;
    scores: Record<string, { home_score: number; away_score: number }>;
  };

  if (!prediction_id || !scores) {
    return json({ error: 'Falta prediction_id o scores' }, { status: 400 });
  }

  if (Object.keys(scores).length > 200) {
    return json({ error: 'Demasiados partidos' }, { status: 400 });
  }

  // Verify ownership
  const { rows: predRows } = await query('SELECT user_id, pool_id FROM predictions WHERE id = $1', [prediction_id]);
  const pred = predRows[0] ?? null;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Verify pool membership
  const { rows: membership } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [pred.pool_id, locals.user.id]
  );
  if (membership.length === 0) {
    return json({ error: 'No eres miembro de este pool' }, { status: 403 });
  }

  // Check deadline (per-phase)
  const { rows: poolRows } = await query(
    'SELECT deadline_group, deadline_knockout FROM pools WHERE id = $1',
    [pred.pool_id]
  );
  const poolCheck = poolRows[0] ?? null;

  // §3.3 — Validate each match id is a positive integer up-front so a non-numeric
  // key cannot cascade into a NaN INSERT later.
  for (const k of Object.keys(scores)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) {
      return json({ error: `match id inválido: ${k}` }, { status: 400 });
    }
  }
  const matchIds = Object.keys(scores).map(Number);
  const droppedMatches: number[] = [];
  if (matchIds.length > 0) {
    // §2.8 — Drop matches that have already started instead of rejecting
    // the whole batch. Mirrors the group/bracket pattern so the autosave
    // path doesn't lose unrelated edits.
    const { rows: started } = await query(
      'SELECT id FROM matches WHERE id = ANY($1::int[]) AND kickoff_time IS NOT NULL AND kickoff_time <= NOW()',
      [matchIds]
    );
    const startedSet = new Set(started.map((r: any) => Number(r.id)));
    for (const id of startedSet) {
      delete (scores as Record<string, unknown>)[String(id)];
      droppedMatches.push(id);
    }
    const remainingIds = Object.keys(scores).map(Number);

    // Also check pool-level phase deadlines (against remaining matches).
    if (remainingIds.length > 0) {
      const { rows: phaseRows } = await query(`
        SELECT
          MAX(CASE WHEN phase = 'group' THEN 1 ELSE 0 END) AS has_group,
          MAX(CASE WHEN phase != 'group' THEN 1 ELSE 0 END) AS has_knockout
        FROM matches WHERE id = ANY($1::int[])
      `, [remainingIds]);
      const phaseRow = phaseRows[0] ?? null;

      const now = new Date();
      if (phaseRow?.has_group && poolCheck?.deadline_group && new Date(poolCheck.deadline_group) <= now) {
        return json({ error: 'La fecha límite de fase de grupos ha pasado' }, { status: 403 });
      }
      if (phaseRow?.has_knockout && poolCheck?.deadline_knockout && new Date(poolCheck.deadline_knockout) <= now) {
        return json({ error: 'La fecha límite de eliminatorias ha pasado' }, { status: 403 });
      }
    }
  }

  // Validate scores: must be integers 0–30
  for (const [matchIdStr, score] of Object.entries(scores)) {
    const homeRaw = score.home_score;
    const awayRaw = score.away_score;
    if (homeRaw != null) {
      const h = Number(homeRaw);
      if (!Number.isInteger(h) || h < 0 || h > 30) {
        return json({ error: `Score inválido para partido ${matchIdStr}` }, { status: 400 });
      }
    }
    if (awayRaw != null) {
      const a = Number(awayRaw);
      if (!Number.isInteger(a) || a < 0 || a > 30) {
        return json({ error: `Score inválido para partido ${matchIdStr}` }, { status: 400 });
      }
    }
  }

  // H-01: Wrap all per-match saves in a transaction for atomicity
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const [matchIdStr, score] of Object.entries(scores)) {
      const matchId = Number(matchIdStr);
      const homeScore = (score.home_score != null) ? Number(score.home_score) : null;
      const awayScore = (score.away_score != null) ? Number(score.away_score) : null;

      if (homeScore === null || awayScore === null) {
        await client.query('DELETE FROM match_predictions WHERE prediction_id = $1 AND match_id = $2', [prediction_id, matchId]);
      } else {
        await client.query(`
          INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT(prediction_id, match_id) DO UPDATE SET
            home_score = $3,
            away_score = $4,
            points_earned = 0
        `, [prediction_id, matchId, homeScore, awayScore]);
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // §3.6 — Score synchronously when the user edits a prediction whose previous
  // points_earned was non-zero. The ON CONFLICT clause above sets points_earned
  // to 0 on update, so the UI would otherwise show a stale total until the
  // setImmediate callback finishes. Doing it inline keeps the displayed total
  // in lockstep with the just-zeroed row.
  const poolId = pred.pool_id;
  try {
    await calculateAllScores(poolId);
    invalidateCachedPoolLeaderboard(poolId);
    invalidateCachedPoolResults(poolId);
    invalidateGlobalLeaderboard();
  } catch (e) {
    console.error('[score] match-scores pool', poolId, e);
    // Fall through — we already saved the prediction; the next sync will
    // reconcile points_earned. Surface the error code, not a generic 500.
    return json({ ok: false, error: 'Predicción guardada, pero el cálculo de puntos falló', scoring: 'failed' }, { status: 500 });
  }

  return json({ ok: true, dropped: droppedMatches });
};
