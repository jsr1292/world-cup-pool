import { db } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { pool_id, allow_multiple_predictions } = body;

  if (!pool_id) return json({ error: 'pool_id required' }, { status: 400 });

  const pool = getPoolById(pool_id) as any;
  if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });
  if (pool.created_by !== locals.user.id) return json({ error: 'Prohibido' }, { status: 403 });

  db.prepare('UPDATE pools SET allow_multiple_predictions = ? WHERE id = ?').run(allow_multiple_predictions ? 1 : 0, pool_id);

  return json({ ok: true });
};
