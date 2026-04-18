import { db } from '$lib/server/db.js';
import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

// GET /api/predictions/tiebreaker?prediction_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const predictionId = Number(url.searchParams.get('prediction_id'));
  if (!predictionId) return json({ error: 'Falta prediction_id' }, { status: 400 });

  const pred = db.prepare('SELECT user_id FROM predictions WHERE id = ?').get(predictionId) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  const row = db.prepare('SELECT home_score, away_score FROM tiebreaker WHERE prediction_id = ?').get(predictionId) as any;
  return json(row || { home_score: null, away_score: null });
};

// POST /api/predictions/tiebreaker
// Body: { prediction_id, home_score: number, away_score: number }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

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

  // Verify ownership
  const pred = db.prepare('SELECT user_id, pool_id FROM predictions WHERE id = ?').get(prediction_id) as any;
  if (!pred || pred.user_id !== locals.user.id) {
    return json({ error: 'No es tu predicción' }, { status: 403 });
  }

  // Check deadline
  const pool = db.prepare('SELECT deadline_knockout FROM pools WHERE id = ?').get(pred.pool_id) as any;
  if (pool?.deadline_knockout && new Date(pool.deadline_knockout) <= new Date()) {
    return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
  }

  // Upsert
  if (home_score !== null && away_score !== null) {
    db.prepare(`
      INSERT INTO tiebreaker (prediction_id, home_score, away_score)
      VALUES (?, ?, ?)
      ON CONFLICT(prediction_id) DO UPDATE SET home_score = ?, away_score = ?
    `).run(prediction_id, home_score, away_score, home_score, away_score);
  } else {
    db.prepare('DELETE FROM tiebreaker WHERE prediction_id = ?').run(prediction_id);
  }

  return json({ ok: true });
};
