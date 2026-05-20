import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  const { current_password, new_password } = await request.json();
  if (!current_password || !new_password)
    return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
  if (new_password.length < 6)
    return json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' }, { status: 400 });

  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user || !verifyPwd(current_password, user.password_hash))
    return json({ error: 'Contraseña actual incorrecta' }, { status: 401 });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPwd(new_password), locals.user.id);
  return json({ ok: true });
};
