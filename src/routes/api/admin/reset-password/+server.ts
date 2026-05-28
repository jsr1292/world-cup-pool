import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db.js';
import { hashPwd } from '$lib/server/queries.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';
import { errCode } from '$lib/server/err-code.js';
import { parseJsonBody } from '$lib/server/json-body.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'No autorizado' }, { status: 403 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  if (!body || typeof body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { username, new_password } = body as { username?: string; new_password?: string };
  if (!username || !new_password || new_password.length < 6) {
    return json({ error: 'Datos inválidos' }, { status: 400 });
  }

  try {
    // §1.2 — Resolve the target user id BEFORE deleting their sessions so we
    // can clear the in-process session cache for that user.
    const { rows: targetRows } = await query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    const target = targetRows[0] ?? null;
    if (!target) return json({ error: 'Usuario no encontrado' }, { status: 404 });
    const targetUserId = Number(target.id);

    const hash = await hashPwd(new_password);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, targetUserId]);

    // Invalidate all sessions for this user (DB + in-process cache)
    await query('DELETE FROM sessions WHERE user_id = $1', [targetUserId]);
    invalidateCachedSessionByUserId(targetUserId);

    // §1.10 — Audit trail for password resets.
    await logAudit('reset_password', locals.user.id, 'user', targetUserId, null, { username });

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/reset-password] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
