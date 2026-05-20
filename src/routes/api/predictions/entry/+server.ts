import { createPrediction } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { pool_id, label = '' } = body;

  if (!pool_id) return json({ error: 'pool_id required' }, { status: 400 });

  // Check allow_multiple
  const { db } = await import('$lib/server/db.js');
  const pool = db.prepare('SELECT * FROM pools WHERE id = ?').get(pool_id) as any;
  if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });

  const member = db
    .prepare('SELECT 1 FROM pool_members WHERE pool_id = ? AND user_id = ?')
    .get(pool_id, locals.user.id);
  if (!member) return json({ error: 'No eres miembro de esta quiniela' }, { status: 403 });

  if (!pool.allow_multiple_predictions) {
    // Check if user already has a prediction in this pool
    const existing = db.prepare(
      'SELECT id FROM predictions WHERE pool_id = ? AND user_id = ?'
    ).get(pool_id, locals.user.id);
    if (existing) {
      return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 403 });
    }
  }

  // Check user already has a prediction with this label
  const existing = db.prepare(
    "SELECT id FROM predictions WHERE pool_id = ? AND user_id = ? AND label = ?"
  ).get(pool_id, locals.user.id, label);

  if (existing) {
    return json({ error: 'Ya existe una entrada con ese nombre' }, { status: 409 });
  }

  const result = createPrediction(pool_id, locals.user.id, label);
  if (!result) return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 409 });
  return json({ id: Number(result.lastInsertRowid), label });
};
