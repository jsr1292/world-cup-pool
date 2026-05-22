import { createPrediction } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { pool_id, label = '' } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  // Check allow_multiple
  const { rows: poolRows } = await query('SELECT * FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] as any;
  if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });

  const { rows: memberRows } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [pool_id, locals.user.id]
  );
  if (memberRows.length === 0) return json({ error: 'No eres miembro de esta quiniela' }, { status: 403 });

  if (!pool.allow_multiple_predictions) {
    // Check if user already has a prediction in this pool
    const { rows: existingRows } = await query(
      'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2',
      [pool_id, locals.user.id]
    );
    if (existingRows.length > 0) {
      return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 403 });
    }
  }

  // Check user already has a prediction with this label
  const { rows: existingLabelRows } = await query(
    'SELECT id FROM predictions WHERE pool_id = $1 AND user_id = $2 AND label = $3',
    [pool_id, locals.user.id, label]
  );

  if (existingLabelRows.length > 0) {
    return json({ error: 'Ya existe una entrada con ese nombre' }, { status: 409 });
  }

  const result = await createPrediction(pool_id, locals.user.id, label);
  if (!result) return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 409 });
  return json({ id: Number(result.rows[0].id), label });
};
