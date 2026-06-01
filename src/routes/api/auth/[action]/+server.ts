import {
  authenticateUser, createUser, createSession,
  createEmailVerificationToken, markEmailVerified, getUserEmailById,
} from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { isValidEmail, isEmailDomainAllowed, allowedEmailDomain } from '$lib/server/email-policy.js';
import { isEmailConfigured, sendVerificationEmail } from '$lib/server/email.js';
import { json, redirect, type RequestHandler } from '@sveltejs/kit';

const SESSION_COOKIE = {
  path: '/', maxAge: 30 * 24 * 60 * 60, httpOnly: true,
  sameSite: 'lax' as const, secure: process.env.NODE_ENV !== 'development',
};

/** Public base for emailed links: PUBLIC_BASE_URL if set, else the request origin. */
function publicBase(originUrl: URL): string {
  return (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '') || originUrl.origin;
}

/** Generate + email a verification link. Best-effort; logs on failure. */
async function sendVerification(userId: number, email: string, base: string): Promise<void> {
  const token = await createEmailVerificationToken(userId);
  await sendVerificationEmail(email, `${base}/verify-email?token=${encodeURIComponent(token)}`);
}

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

export const POST: RequestHandler = async ({ request, cookies, params, url, getClientAddress }) => {
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
    const { email, email_confirm, password, display_name } = body as Record<string, any>;
    if (!email || !password || !display_name) {
      return json({ error: 'Todos los campos son obligatorios' }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return json({ error: 'Correo electrónico no válido' }, { status: 400 });
    }
    // Typo guard (works without SMTP): the two email fields must match.
    if (typeof email_confirm === 'string' &&
        email_confirm.trim().toLowerCase() !== String(email).trim().toLowerCase()) {
      return json({ error: 'Los correos no coinciden' }, { status: 400 });
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
      const userId = Number(result.rows[0].id);

      // Promote to admin at REGISTRATION time if this account matches the
      // configured admin_username (by handle or email). apply-config only runs at
      // boot, so on a fresh DB the admin account doesn't exist yet when it runs —
      // without this, the owner registers and is NOT admin until a restart.
      const adminUser = (process.env.ADMIN_USERNAME || '').trim();
      if (adminUser && adminUser !== 'null') {
        await query(
          'UPDATE users SET is_admin = true WHERE id = $1 AND (username = $2 OR lower(email) = lower($2))',
          [userId, adminUser]
        ).catch((e) => console.error('[auth] admin auto-promote failed:', e));
      }

      if (isEmailConfigured()) {
        // Strict: must confirm via the emailed link before logging in. No session.
        try {
          await sendVerification(userId, String(email).trim(), publicBase(url));
        } catch (mailErr) {
          console.error('[auth] verification email failed:', mailErr);
          return json({ ok: true, verify: true, mailFailed: true });
        }
        return json({ ok: true, verify: true });
      }

      // No SMTP: can't verify by email, so trust the confirm-field guard and
      // mark verified + log in immediately.
      await markEmailVerified(userId);
      const token = await createSession(userId);
      cookies.set('session', token, SESSION_COOKIE);
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

      // When SMTP is configured, require a verified email. Auto-resend the link
      // on a blocked attempt so the user has a fresh one without extra UI.
      if (isEmailConfigured() && !user.email_verified_at) {
        try {
          const addr = await getUserEmailById(user.id);
          if (addr) await sendVerification(user.id, addr, publicBase(url));
        } catch (mailErr) {
          console.error('[auth] resend verification on login failed:', mailErr);
        }
        return json({
          error: 'Verifica tu correo para entrar. Te hemos reenviado el enlace de confirmación.',
          needs_verification: true,
        }, { status: 403 });
      }

      const token = await createSession(user.id);
      cookies.set('session', token, SESSION_COOKIE);
      return json({ ok: true });
    } catch (e) {
      console.error('[auth] Login error:', e);
      return json({ error: 'Error al iniciar sesión' }, { status: 500 });
    }
  }

  return json({ error: 'Acción desconocida' }, { status: 400 });
};
