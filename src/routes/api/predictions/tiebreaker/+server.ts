import { errCode } from '$lib/server/err-code.js';
import { asId } from '$lib/server/json-body.js';
import { query } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

// GET /api/predictions/tiebreaker?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = asId(url.searchParams.get('prediction_id'));
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
    const code = errCode();
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { prediction_id: rawPredictionId, home_score, away_score } = body as {
    prediction_id?: unknown;
    home_score?: number | null;
    away_score?: number | null;
  };

  // Clean int or reject — floats/strings/overflow would 500 at the SQL cast.
  const prediction_id = asId(rawPredictionId);
  if (!prediction_id) return json({ error: 'Falta prediction_id' }, { status: 400 });

  // §1.6 — Reject mixed-null state. The caller must either set both goals
  // or clear both; otherwise the save branch would silently delete the row
  // and surface a misleading "saved" status to the client.
  const h = home_score ?? null;
  const a = away_score ?? null;
  if ((h === null) !== (a === null)) {
    return json({ error: 'Debes indicar ambos goles o ninguno' }, { status: 400 });
  }

  // Validate scores
  if (h !== null && a !== null) {
    if (!Number.isInteger(h) || !Number.isInteger(a)) {
      return json({ error: 'Los goles deben ser números enteros' }, { status: 400 });
    }
    if (h < 0 || a < 0 || h > 30 || a > 30) {
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
    if (h !== null && a !== null) {
      await query(`
        INSERT INTO tiebreaker (prediction_id, home_score, away_score)
        VALUES ($1, $2, $3)
        ON CONFLICT(prediction_id) DO UPDATE SET home_score = $2, away_score = $3
      `, [prediction_id, h, a]);
      action = 'saved';
    } else {
      await query('DELETE FROM tiebreaker WHERE prediction_id = $1', [prediction_id]);
      action = 'deleted';
    }

    return json({ ok: true, action });
  } catch (e) {
    const code = errCode();
    console.error(`[api/predictions/tiebreaker] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
