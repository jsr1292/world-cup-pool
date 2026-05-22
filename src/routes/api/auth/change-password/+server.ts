import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals, cookies }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  const { current_password, new_password } = await request.json();
  if (!current_password || !new_password)
    return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
  if (new_password.length < 6)
    return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' }, { status: 400 });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [locals.user.id]);
  const user = rows[0] as any;
  if (!user || !await verifyPwd(current_password, user.password_hash))
    return json({ error: 'Contraseña actual incorrecta' }, { status: 401 });

  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPwd(new_password), locals.user.id]);
  // Invalidate all other sessions (keep current one alive)
  await query('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [locals.user.id, cookies.get('session')]);
  return json({ ok: true });
};
