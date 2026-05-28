import { query } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

// GET /api/predictions/tiebreaker?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = Number(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Falta prediction_id' }, { status: 400 });

  try {
    const { rows: predRows } = await query('SELECT user_id FROM predictions WHERE id = $1', [predictionId]);
    const pred = predRows[0] ?? null;
    if (!pred || pred.user_id !== locals.user.id) {
      return json({ error: 'No es tu predicción' }, { status: 403 });
    }

    const { rows } = await query('SELECT home_score, away_score FROM tiebreaker WHERE prediction_id = $1', [predictionId]);
    return json(rows[0] ?? { home_score: null, away_score: null });
  } catch (e) {
    const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    console.error(`[api/predictions/tiebreaker] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// POST /api/predictions/tiebreaker
// Body: { prediction_id, home_score: number, away_score: number }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  const body = await request.json();
  const { prediction_id, home_score, away_score } = body as {
    prediction_id: number;
    home_score: number | null;
    away_score: number | null;
  };

  if (!prediction_id) return json({ error: 'Falta prediction_id' }, { status: 400 });

  // Validate scores
  if (home_score !== null && away_score !== null) {
    if (!Number.isInteger(home_score) || !Number.isInteger(away_score)) {
      return json({ error: 'Los goles deben ser números enteros' }, { status: 400 });
    }
    if (home_score < 0 || away_score < 0 || home_score > 30 || away_score > 30) {
      return json({ error: 'Goles fuera de rango (0-30)' }, { status: 400 });
    }
  }

  try {
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

    // Check deadline
    const { rows: poolRows } = await query('SELECT deadline_knockout FROM pools WHERE id = $1', [pred.pool_id]);
    const pool = poolRows[0] ?? null;
    if (pool?.deadline_knockout && new Date(pool.deadline_knockout) <= new Date()) {
      return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
    }

    // §3.9 — Surface whether we saved or deleted so the UI can show the right
    // confirmation toast.
    let action: 'saved' | 'deleted';
    if (home_score !== null && away_score !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, home_score, away_score]);
      action = 'saved';
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
      action = 'deleted';
    }

    return json({ ok: true, action });
  } catch (e) {
    const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    console.error(`[api/predictions/tiebreaker] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
