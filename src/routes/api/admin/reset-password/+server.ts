import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { query } from '$lib/server/db.js';
import { hashPwd } from '$lib/server/queries.js';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user?.is_admin) return json({ error: 'No autorizado' }, { status: 403 });

  const { username, new_password } = await request.json();
  if (!username || !new_password || new_password.length < 6) {
    return json({ error: 'Datos inválidos' }, { status: 400 });
  }

  const hash = await hashPwd(new_password);
  const { rowCount } = await query(
    'UPDATE users SET password_hash = $1 WHERE username = $2',
    [hash, username]
  );

  if (rowCount === 0) return json({ error: 'Usuario no encontrado' }, { status: 404 });

  // Invalidate all sessions for this user
  await query('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = $1)', [username]);

  return json({ ok: true });
};
