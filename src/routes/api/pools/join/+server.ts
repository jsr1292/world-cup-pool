import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

const MAX_POOL_MEMBERS = 200; // hard cap; adjust if pools need to be larger

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

  try {
		const { code } = await request.json();
		if (!code || typeof code !== 'string') return json({ error: 'Código requerido' }, { status: 400 });
		// B3-3: Validar formato del código antes de consultar la BD (16 chars base64url)
		if (!/^[A-Za-z0-9_-]{16}$/.test(code)) {
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

    return json({ pool_id: pool.id });
  } catch (e) {
    console.error('[api/pools/join] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
