import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createBackup, listBackups } from '$lib/server/backup.js';
import { db } from '$lib/server/db.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  const { label = 'manual' } = await request.json() as { label?: string };
  const backup = createBackup(label);
  return json({ ok: true, ...backup });
};

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  return json(listBackups());
};
