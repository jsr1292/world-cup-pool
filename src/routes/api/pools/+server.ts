import { createPool } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

async function canCreatePools(userId: number): Promise<boolean> {
  // Check site-wide setting
  const { rows: settingRows } = await query("SELECT value FROM site_settings WHERE key = 'can_create_pools'");
  const setting = settingRows[0] ?? null;
  const mode = setting?.value ?? 'admin';

  if (mode === 'anyone') return true;

  // 'admin' mode — check if user is admin or explicitly allowed
  const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  const user = userRows[0] ?? null;
  if (user?.is_admin) return true;

  const { rows: allowedRows } = await query('SELECT 1 FROM pool_creators WHERE user_id = $1', [userId]);
  return allowedRows.length > 0;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  if (!await canCreatePools(locals.user.id)) {
    return json({ error: 'No tienes permiso para crear quinielas' }, { status: 403 });
  }

  const body = await request.json();
  const { name, buy_in = 0, allow_multiple = false } = body;

  if (!name?.trim() || name.trim().length < 2) return json({ error: 'Nombre requerido (mínimo 2 caracteres)' }, { status: 400 });
  if (typeof buy_in === 'number' && buy_in < 0) return json({ error: 'buy_in debe ser positivo' }, { status: 400 });

  const result = await createPool(name.trim(), locals.user.id, buy_in, allow_multiple ? 1 : 0);
  return json({ id: Number(result.id), invite_code: result.inviteCode });
};
