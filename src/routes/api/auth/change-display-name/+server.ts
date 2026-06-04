import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { logAudit } from '$lib/server/audit.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';
import { MAX_DISPLAY_NAME_CHANGES, normalizeDisplayName, displayNameChangesUsed } from '$lib/server/display-name.js';

// POST /api/auth/change-display-name  Body: { display_name }
// Changes the user's display name — the name shown in each pool's Clasificación.
// Capped at MAX_DISPLAY_NAME_CHANGES per user (counted from the audit log).
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  if (!checkAuthRate(locals.user.id)) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo inválido' }, { status: 400 }); }

  const name = normalizeDisplayName(body?.display_name);
  if (name.length < 1) return json({ error: 'El nombre es obligatorio' }, { status: 400 });
  if (name.length > 50) return json({ error: 'El nombre no puede superar los 50 caracteres' }, { status: 400 });

  try {
    const { rows: meRows } = await query('SELECT display_name FROM users WHERE id = $1', [locals.user.id]);
    const current = meRows[0]?.display_name;
    if (current == null) return json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (name === current) return json({ error: 'Ese ya es tu nombre' }, { status: 400 });

    const used = await displayNameChangesUsed(locals.user.id);
    if (used >= MAX_DISPLAY_NAME_CHANGES) {
      return json({ error: `Has alcanzado el máximo de ${MAX_DISPLAY_NAME_CHANGES} cambios de nombre.` }, { status: 403 });
    }

    await query('UPDATE users SET display_name = $1 WHERE id = $2', [name, locals.user.id]);
    await logAudit('change_display_name', locals.user.id, 'user', locals.user.id, { display_name: current }, { display_name: name });
    // Refresh the cached session so the new name shows on the next request.
    invalidateCachedSessionByUserId(locals.user.id);

    return json({ ok: true, display_name: name, remaining: Math.max(0, MAX_DISPLAY_NAME_CHANGES - (used + 1)) });
  } catch (e) {
    const code = errCode();
    console.error(`[api/auth/change-display-name] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
