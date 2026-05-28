import { query } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const body = await request.json();
    const { pool_id, allow_multiple_predictions } = body;

    if (!pool_id) return json({ error: 'pool_id required' }, { status: 400 });

    const pool = (await getPoolById(pool_id)) as any;
    if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });
    if (pool.created_by !== locals.user.id) return json({ error: 'Prohibido' }, { status: 403 });

    await query('UPDATE pools SET allow_multiple_predictions = $1 WHERE id = $2', [allow_multiple_predictions ? true : false, pool_id]);

    return json({ ok: true });
  } catch (e) {
    const code = `ERR_${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    console.error(`[api/admin/pool-settings] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
