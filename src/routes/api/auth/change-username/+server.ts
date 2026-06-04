import { errCode } from '$lib/server/err-code.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { logAudit } from '$lib/server/audit.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';
import { MAX_USERNAME_CHANGES, USERNAME_RE, normalizeUsername, usernameChangesUsed } from '$lib/server/username.js';

// POST /api/auth/change-username  Body: { username }
// Changes the logged-in user's public @handle (NOT their email). Capped at
// MAX_USERNAME_CHANGES per user, counted from the audit log.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });
  if (!checkAuthRate(locals.user.id)) {
    return json({ error: 'Demasiados intentos. Espera 15 minutos.' }, { status: 429 });
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo inválido' }, { status: 400 }); }

  const username = normalizeUsername(body?.username);
  if (!username) return json({ error: 'El nombre de usuario es obligatorio' }, { status: 400 });
  if (!USERNAME_RE.test(username)) {
    return json({ error: 'Usa 3–20 caracteres: letras, números o guion bajo' }, { status: 400 });
  }

  try {
    const { rows: meRows } = await query('SELECT username FROM users WHERE id = $1', [locals.user.id]);
    const current = meRows[0]?.username;
    if (!current) return json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (username === current) return json({ error: 'Ese ya es tu nombre de usuario' }, { status: 400 });

    // Privilege-escalation guard: never let a user take the configured admin
    // handle (the boot auto-promote matches on username = ADMIN_USERNAME).
    // INVARIANT: usernames are ALWAYS stored lowercased (deriveHandle + the
    // normalize above), so comparing against the lowercased ADMIN_USERNAME blocks
    // every form a user could actually hold. The promote queries
    // ([action]/+server.ts, apply-config.mjs) match `username` case-sensitively;
    // do NOT relax them to lower(username) without keeping this guard lowercased.
    const adminUser = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
    if (adminUser && adminUser !== 'null' && username === adminUser) {
      return json({ error: 'Ese nombre de usuario no está disponible' }, { status: 409 });
    }

    // Lifetime cap.
    const used = await usernameChangesUsed(locals.user.id);
    if (used >= MAX_USERNAME_CHANGES) {
      return json({ error: `Has alcanzado el máximo de ${MAX_USERNAME_CHANGES} cambios de nombre de usuario.` }, { status: 403 });
    }

    // Uniqueness (usernames are stored lowercased).
    const { rows: taken } = await query('SELECT 1 FROM users WHERE lower(username) = $1 AND id <> $2', [username, locals.user.id]);
    if (taken.length) return json({ error: 'Ese nombre de usuario ya está en uso' }, { status: 409 });

    try {
      await query('UPDATE users SET username = $1 WHERE id = $2', [username, locals.user.id]);
    } catch (e: any) {
      if (e?.code === '23505') return json({ error: 'Ese nombre de usuario ya está en uso' }, { status: 409 });
      throw e;
    }

    await logAudit('change_username', locals.user.id, 'user', locals.user.id, { username: current }, { username });
    // Drop the cached session row so the new handle shows up on the next request.
    invalidateCachedSessionByUserId(locals.user.id);

    return json({ ok: true, username, remaining: Math.max(0, MAX_USERNAME_CHANGES - (used + 1)) });
  } catch (e) {
    const code = errCode();
    console.error(`[api/auth/change-username] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
