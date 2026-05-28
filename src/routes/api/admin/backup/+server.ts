import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { createBackup, listBackups, restoreBackup } from '$lib/server/backup.js';
import { query } from '$lib/server/db.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { label = 'manual' } = parsed.body as { label?: string };
    const backup = createBackup(label);
    return json({ ok: true, ...backup });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/backup] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
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
    const code = errCode();
    console.error(`[api/admin/backup] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// PUT /api/admin/backup — restore from a backup
export const PUT: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
    const user = userRows[0] ?? null;
    if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const { name } = parsed.body as { name: string };
    if (!name) return json({ error: 'Falta nombre del backup' }, { status: 400 });

    // §1.13 — Strict allowlist: alphanumerics + hyphen/underscore only. Blocks
    // %xx-encoded variants, null bytes, Windows-drive prefixes, and the
    // `/`, `\`, `..` cases above.
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      return json({ error: 'Nombre inválido' }, { status: 400 });
    }

    restoreBackup(name); // always throws for Neon — caught below
    return json({ ok: true });
  } catch (e: any) {
    const code = errCode();
    console.error(`[api/admin/backup] ${code}:`, e);
    return json({ error: e.message ?? 'Internal server error', code }, { status: 500 });
  }
};
