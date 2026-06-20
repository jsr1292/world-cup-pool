import { json, type RequestHandler } from '@sveltejs/kit';
import { query } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { checkChatRate } from '$lib/server/rate-limit.js';
import { notifyPoolMessage } from '$lib/server/push.js';

const MAX_LEN = 500;

async function gate(poolId: number, userId: number): Promise<any | null> {
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) return null;
  const pool = await getPoolById(poolId) as any;
  if (!pool) return null;
  const { rows } = await query('SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
  if (rows.length === 0 && pool.created_by !== userId) return null;
  return pool;
}

// GET /api/pools/[id]/messages?after=<id> — messages after <id>, else the most
// recent ~100. Incremental fetch keeps polling cheap.
export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const poolId = Number(params.id);
  const pool = await gate(poolId, locals.user.id);
  if (!pool) return json({ error: 'No disponible' }, { status: 403 });

  const afterRaw = url.searchParams.get('after');
  const after = afterRaw && /^\d+$/.test(afterRaw) ? Number(afterRaw) : 0;

  let rows;
  if (after > 0) {
    ({ rows } = await query(
      `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at
       FROM pool_messages m JOIN users u ON u.id = m.user_id
       WHERE m.pool_id = $1 AND m.id > $2 ORDER BY m.id ASC LIMIT 200`,
      [poolId, after]
    ));
  } else {
    const r = await query(
      `SELECT m.id, m.user_id, u.display_name, m.body, m.created_at
       FROM pool_messages m JOIN users u ON u.id = m.user_id
       WHERE m.pool_id = $1 ORDER BY m.id DESC LIMIT 100`,
      [poolId]
    );
    rows = r.rows.reverse();
  }

  const me = locals.user.id;
  const messages = rows.map((r: any) => ({
    id: Number(r.id), user_id: Number(r.user_id), display_name: r.display_name,
    body: r.body, created_at: r.created_at, mine: Number(r.user_id) === me,
  }));
  return json({ messages });
};

// POST /api/pools/[id]/messages — { body }
export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const poolId = Number(params.id);
  const pool = await gate(poolId, locals.user.id);
  if (!pool) return json({ error: 'No disponible' }, { status: 403 });

  if (!checkChatRate(locals.user.id)) {
    return json({ error: 'Vas muy rápido. Espera un momento.' }, { status: 429 });
  }

  const data = await request.json().catch(() => null);
  const body = typeof data?.body === 'string' ? data.body.trim() : '';
  if (!body) return json({ error: 'Mensaje vacío' }, { status: 400 });
  if (body.length > MAX_LEN) return json({ error: `Máximo ${MAX_LEN} caracteres` }, { status: 400 });

  const { rows } = await query(
    'INSERT INTO pool_messages (pool_id, user_id, body) VALUES ($1, $2, $3) RETURNING id, created_at',
    [poolId, locals.user.id, body]
  );
  const msg = {
    id: Number(rows[0].id), user_id: locals.user.id, display_name: locals.user.display_name,
    body, created_at: rows[0].created_at, mine: true,
  };

  // Best-effort throttled push to the other members.
  notifyPoolMessage(poolId, locals.user.id, locals.user.display_name ?? 'Alguien', pool.name, body)
    .catch((e) => console.error('[chat] notify failed:', e));

  return json({ message: msg });
};

// DELETE /api/pools/[id]/messages — { id }. Author, creator, or site admin.
export const DELETE: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  const poolId = Number(params.id);
  const pool = await gate(poolId, locals.user.id);
  if (!pool) return json({ error: 'No disponible' }, { status: 403 });

  const data = await request.json().catch(() => null);
  const id = Number(data?.id);
  if (!Number.isInteger(id) || id < 1) return json({ error: 'id inválido' }, { status: 400 });

  const canModerate = pool.created_by === locals.user.id || !!locals.user.is_admin;
  const { rowCount } = await query(
    canModerate
      ? 'DELETE FROM pool_messages WHERE id = $1 AND pool_id = $2'
      : 'DELETE FROM pool_messages WHERE id = $1 AND pool_id = $2 AND user_id = $3',
    canModerate ? [id, poolId] : [id, poolId, locals.user.id]
  );
  if (!rowCount) return json({ error: 'No se pudo borrar' }, { status: 403 });
  return json({ ok: true });
};
