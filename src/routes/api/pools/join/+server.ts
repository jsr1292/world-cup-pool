import { errCode } from '$lib/server/err-code.js';
import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { json, type RequestHandler } from '@sveltejs/kit';

const MAX_POOL_MEMBERS = 200; // hard cap; adjust if pools need to be larger

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

  // Parse outside the main try: a malformed/null body used to fall into the
  // generic catch and surface as a 500 instead of a 400.
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  try {
		const { code } = body;
		if (!code || typeof code !== 'string') return json({ error: 'Código requerido' }, { status: 400 });
		// §1.14 — Match generateInviteCode() which now emits 24-char uppercase
		// base64url. Anything else is malformed.
		if (!/^[A-Z0-9_-]{24}$/.test(code.toUpperCase())) {
			return json({ error: 'Código de invitación inválido' }, { status: 400 });
		}

		const pool = await getPoolByInvite(code.toUpperCase());
    if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });
    // B3-5: Impedir unirse a quinielas desactivadas
    if (pool.is_active === false) {
      return json({ error: 'Esta quiniela ya no está activa' }, { status: 403 });
    }

    // B3-1: Enforce member cap before joining
    const { rows: countRows } = await query(
      'SELECT COUNT(*) AS cnt FROM pool_members WHERE pool_id = $1',
      [pool.id]
    );
    const memberCount = Number(countRows[0].cnt);
    if (memberCount >= MAX_POOL_MEMBERS) {
      return json({ error: `Esta quiniela ya tiene el máximo de ${MAX_POOL_MEMBERS} participantes` }, { status: 403 });
    }

    const joined = await joinPool(pool.id, locals.user.id);
    if (!joined) return json({ error: 'Ya estás en esta quiniela' }, { status: 409 });

    // The global board is scoped by pool membership, so a new member changes who
    // the joiner (and this pool's existing members) can see — drop the cache.
    invalidateGlobalLeaderboard();

    return json({ pool_id: pool.id });
  } catch (e) {
    const code = errCode();
    console.error(`[api/pools/join] ${code}:`, e);
    // §4.12 — Surface a short opaque code so ops can correlate the user's
    // report with a server log entry without exposing internals.
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
