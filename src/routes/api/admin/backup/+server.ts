import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createBackup, listBackups, restoreBackup } from '$lib/server/backup.js';
import { query } from '$lib/server/db.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const { label = 'manual' } = await request.json() as { label?: string };
    const backup = createBackup(label);
    return json({ ok: true, ...backup });
  } catch (e) {
    console.error('[api/admin/backup] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    return json(listBackups());
  } catch (e) {
    console.error('[api/admin/backup] GET error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};

// PUT /api/admin/backup — restore from a backup
export const PUT: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const { name } = await request.json() as { name: string };
    if (!name) return json({ error: 'Falta nombre del backup' }, { status: 400 });

    // Validate filename (no path traversal)
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      return json({ error: 'Nombre inválido' }, { status: 400 });
    }

    restoreBackup(name); // always throws for Neon — caught below
    return json({ ok: true });
  } catch (e: any) {
    console.error('[api/admin/backup] PUT error:', e);
    return json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
};
