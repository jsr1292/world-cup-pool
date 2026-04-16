import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'pool.db');

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

  const { current_password, new_password } = await request.json();
  if (!current_password || !new_password) {
    return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
  }
  if (new_password.length < 4) {
    return json({ error: 'La nueva contraseña debe tener al menos 4 caracteres' }, { status: 400 });
  }

  const db = new Database(DB_PATH);
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(locals.user.id) as any;
  
  if (!user || !verifyPwd(current_password, user.password_hash)) {
    db.close();
    return json({ error: 'Contraseña actual incorrecta' }, { status: 401 });
  }

  const newHash = hashPwd(new_password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, locals.user.id);
  db.close();

  return json({ ok: true });
};
