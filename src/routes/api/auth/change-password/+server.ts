import { errCode } from '$lib/server/err-code.js';
import { verifyPwd, hashPwd, hashSessionToken } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  if (!checkAuthRate(locals.user.id)) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { current_password, new_password } = body ?? {};
  if (!current_password || !new_password)
    return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
  if (new_password.length < 6)
    return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' }, { status: 400 });
  // bcrypt only uses the first 72 bytes; cap to avoid pointless hashing work.
  if (typeof new_password !== 'string' || new_password.length > 256 || String(current_password).length > 256)
    return json({ error: 'La contraseña es demasiado larga (máximo 256)' }, { status: 400 });

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [locals.user.id]);
    const user = rows[0] as any;
    if (!user || !await verifyPwd(current_password, user.password_hash))
      return json({ error: 'Contraseña actual incorrecta' }, { status: 401 });

    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPwd(new_password), locals.user.id]);
    // §1.3 — Revoke every OTHER session for this user, keeping the caller's.
    // Session tokens are SHA-256 hashed at rest, so we compare the current
    // cookie's hash against the stored hashes.
    const currentTokenHash = hashSessionToken(cookies.get('session') ?? '');
    await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [locals.user.id, currentTokenHash]);
    // Evict this user's cached sessions too (the cache is keyed by RAW token, so
    // we can't target the now-deleted hashed rows individually). The caller's
    // session simply re-populates from the DB on the next request; the revoked
    // ones can't, closing the "stolen cookie rides the cache for 60s" window.
    invalidateCachedSessionByUserId(locals.user.id);
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/auth/change-password] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
