import { createPool } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

function canCreatePools(userId: number): boolean {
  // Check site-wide setting
  const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'can_create_pools'").get() as any;
  const mode = setting?.value ?? 'admin';

  if (mode === 'anyone') return true;

  // 'admin' mode — check if user is admin or explicitly allowed
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as any;
  if (user?.is_admin) return true;

  const allowed = db.prepare('SELECT 1 FROM pool_creators WHERE user_id = ?').get(userId);
  return !!allowed;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  if (!canCreatePools(locals.user.id)) {
    return json({ error: 'No tienes permiso para crear quinielas' }, { status: 403 });
  }

  const body = await request.json();
  const { name, buy_in = 0, allow_multiple = false } = body;

  if (!name?.trim() || name.trim().length < 2) return json({ error: 'Nombre requerido (mínimo 2 caracteres)' }, { status: 400 });
  if (typeof buy_in === 'number' && buy_in < 0) return json({ error: 'buy_in debe ser positivo' }, { status: 400 });

  const result = createPool(name.trim(), locals.user.id, buy_in, allow_multiple ? 1 : 0);
  return json({ id: Number(result.id), invite_code: result.inviteCode });
};
