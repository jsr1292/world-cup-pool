import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  const { key, value } = await request.json() as { key: string; value: string };
  if (!key || !value) return json({ error: 'Faltan campos' }, { status: 400 });

  const ALLOWED_SETTINGS = new Set(['can_create_pools']);
  if (!ALLOWED_SETTINGS.has(key)) return json({ error: 'Clave desconocida' }, { status: 400 });

  db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value);
  return json({ ok: true });
};
