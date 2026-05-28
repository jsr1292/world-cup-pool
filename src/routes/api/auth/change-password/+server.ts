import { errCode } from '$lib/server/err-code.js';
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { invalidateCachedSession } from '$lib/server/cache.js';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  if (!checkAuthRate(locals.user.id)) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }
  const { current_password, new_password } = await request.json();
  if (!current_password || !new_password)
    return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
  if (new_password.length < 6)
    return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' }, { status: 400 });

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [locals.user.id]);
    const user = rows[0] as any;
    if (!user || !await verifyPwd(current_password, user.password_hash))
      return json({ error: 'Contraseña actual incorrecta' }, { status: 401 });

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPwd(new_password), locals.user.id]);
    // §1.3 — Capture other sessions BEFORE deletion so we can clear their
    // entries from the in-process session cache (otherwise a stolen cookie
    // remains "valid" against the cache for up to 60s after this call).
    const currentToken = cookies.get('session');
    const { rows: otherTokens } = await query(
      'SELECT token FROM sessions WHERE user_id = $1 AND token != $2',
      [locals.user.id, currentToken]
    );
    await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [locals.user.id, currentToken]);
    for (const row of otherTokens) {
      invalidateCachedSession(row.token);
    }
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/auth/change-password] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
