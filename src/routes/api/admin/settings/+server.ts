import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const { key, value } = await request.json() as { key: string; value: string };
    if (!key || !value) return json({ error: 'Faltan campos' }, { status: 400 });

    const ALLOWED_SETTINGS = new Set(['can_create_pools']);
    if (!ALLOWED_SETTINGS.has(key)) return json({ error: 'Clave desconocida' }, { status: 400 });

    await query(`
      INSERT INTO site_settings (key, value) VALUES ($1, $2)
      ON CONFLICT(key) DO UPDATE SET value = $2
    `, [key, value]);
    return json({ ok: true });
  } catch (e) {
    console.error('[api/admin/settings] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
