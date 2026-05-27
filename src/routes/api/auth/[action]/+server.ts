import { authenticateUser, createUser, createSession } from '$lib/server/queries.js';
import { json, redirect, type RequestHandler } from '@sveltejs/kit';

const _attempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW = 15 * 60 * 1000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  if (_attempts.size > 10_000) {
    for (const [k, v] of _attempts) {
      if (now > v.resetAt) _attempts.delete(k);
    }
  }
  const e = _attempts.get(ip);
  if (!e || now > e.resetAt) { _attempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return true; }
  if (e.count >= RATE_LIMIT) return false;
  e.count++;
  return true;
}

export const POST: RequestHandler = async ({ request, cookies, params, getClientAddress }) => {
  const action = params.action; // 'login', 'register', or 'logout'
  if ((action === 'login' || action === 'register') && !checkRate(getClientAddress())) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }

  if (action === 'logout') {
    const token = cookies.get('session');
    if (token) {
      const { deleteSession } = await import('$lib/server/queries.js');
      await deleteSession(token);
      cookies.delete('session', { path: '/' });
    }
    throw redirect(303, "/login");
  }

  const body = await request.json();

  if (action === 'register') {
    const { username, password, display_name } = body;
    if (!username || !password) {
      return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
    }
    if (username.length < 3) return json({ error: 'El usuario debe tener al menos 3 caracteres' }, { status: 400 });
    if (username.length > 20) return json({ error: 'El usuario debe tener máximo 20 caracteres' }, { status: 400 });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return json({ error: 'El usuario solo puede contener letras, números y _' }, { status: 400 });
    if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });

    if (display_name && display_name.length > 50) {
      return json({ error: 'El nombre no puede superar 50 caracteres' }, { status: 400 });
    }

    try {
      const result = await createUser(username, password, display_name || username);
      const userId = result.rows[0].id;
      const token = await createSession(Number(userId));
      cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      return json({ ok: true });
    } catch (e: any) {
      if (e.code === '23505' || e.message?.includes('unique constraint') || e.message?.includes('UNIQUE constraint')) {
        return json({ error: 'Nombre de usuario ya en uso' }, { status: 409 });
      }
      return json({ error: 'Error al registrar' }, { status: 500 });
    }
  }

  if (action === 'login') {
    const { username, password } = body;
    if (!username || !password) return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });

    const user = await authenticateUser(username, password);
    if (!user) return json({ error: 'Credenciales incorrectas' }, { status: 401 });

    const token = await createSession(user.id);
    cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return json({ ok: true });
  }

  return json({ error: 'Acción desconocida' }, { status: 400 });
};
