import { getPoolByInvite, joinPool } from '$lib/server/queries.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Inicia sesión' }, { status: 401 });

  const { code } = await request.json();
  if (!code) return json({ error: 'Código requerido' }, { status: 400 });

  const pool = getPoolByInvite(code.toUpperCase());
  if (!pool) return json({ error: 'Código de invitación inválido' }, { status: 404 });

  const joined = joinPool(pool.id, locals.user.id);
  if (!joined) return json({ error: 'Ya estás en esta quiniela' }, { status: 409 });

  return json({ pool_id: pool.id });
};
