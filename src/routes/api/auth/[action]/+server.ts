import { authenticateUser, createUser, createSession } from '$lib/server/queries.js';
import { isValidEmail, isEmailDomainAllowed, allowedEmailDomain } from '$lib/server/email-policy.js';
import { json, redirect, type RequestHandler } from '@sveltejs/kit';

// NOTA (B1-3): Este Map reside en la memoria del proceso. Con múltiples instancias del
// servidor (réplicas de Railway, funciones serverless de Vercel) cada instancia lleva su
// propio contador y el límite de 10 intentos puede eludirse rotando entre instancias.
// Para un límite compartido entre procesos se necesitaría Redis o una tabla PostgreSQL
// (p. ej. auth_rate_limits). Asumimos una sola instancia; si se escala horizontalmente,
// este limitador deberá migrarse a un almacén compartido.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (action === 'register') {
    if (!body || typeof body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { email, password, display_name } = body as Record<string, any>;
    if (!email || !password || !display_name) {
      return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return json({ error: 'Correo electrónico no válido' }, { status: 400 });
    }
    if (!isEmailDomainAllowed(email)) {
      const dom = allowedEmailDomain();
      return json({ error: `Solo se permiten correos @${dom}` }, { status: 403 });
    }
    if (password.length < 6) return json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    if (typeof display_name !== 'string' || display_name.trim().length < 1 || display_name.length > 50) {
      return json({ error: 'El nombre es obligatorio (máximo 50 caracteres)' }, { status: 400 });
    }

    try {
      const result = await createUser(email, password, display_name.trim());
      const userId = result.rows[0].id;
      const token = await createSession(Number(userId));
      cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development' });
      return json({ ok: true });
    } catch (e: any) {
      if (e.code === 'EMAIL_TAKEN') {
        return json({ error: 'Ese correo ya está registrado' }, { status: 409 });
      }
      console.error('[auth] Register error:', e);
      return json({ error: 'Error al registrar' }, { status: 500 });
    }
  }

  if (action === 'login') {
    if (!body || typeof body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { email, password } = body as Record<string, any>;
    if (!email || !password) return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });

    try {
      const user = await authenticateUser(email, password);
      if (!user) return json({ error: 'Credenciales incorrectas' }, { status: 401 });

      const token = await createSession(user.id);
      cookies.set('session', token, { path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV !== 'development' });
      return json({ ok: true });
    } catch (e) {
      console.error('[auth] Login error:', e);
      return json({ error: 'Error al iniciar sesión' }, { status: 500 });
    }
  }

  return json({ error: 'Acción desconocida' }, { status: 400 });
};
