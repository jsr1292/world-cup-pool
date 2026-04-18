import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// POST — add user to pool_creators
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  const { user_id } = await request.json() as { user_id: number };
  if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });

  db.prepare('INSERT OR IGNORE INTO pool_creators (user_id) VALUES (?)').run(user_id);
  return json({ ok: true });
};

// DELETE — remove user from pool_creators
export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  const { user_id } = await request.json() as { user_id: number };
  if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });

  db.prepare('DELETE FROM pool_creators WHERE user_id = ?').run(user_id);
  return json({ ok: true });
};
