import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';

// POST — add user to pool_creators
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { user_id } = parsed.body as { user_id: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });

    await query('INSERT INTO pool_creators (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user_id]);
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/pool-creators] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// DELETE — remove user from pool_creators
export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { user_id } = parsed.body as { user_id: number };
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });

    await query('DELETE FROM pool_creators WHERE user_id = $1', [user_id]);
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/pool-creators] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
