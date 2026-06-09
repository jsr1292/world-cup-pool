import { createPool } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { json, type RequestHandler } from '@sveltejs/kit';

async function canCreatePools(userId: number): Promise<boolean> {
  // Check site-wide setting
  const { rows: settingRows } = await query("SELECT value FROM site_settings WHERE key = 'can_create_pools'");
  const setting = settingRows[0] ?? null;
  const mode = setting?.value ?? 'admin';

  if (mode === 'anyone' || mode === 'all') return true;

  // 'admin' mode — check if user is admin or explicitly allowed
  const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [userId]);
  const user = userRows[0] ?? null;
  if (user?.is_admin) return true;

  const { rows: allowedRows } = await query('SELECT 1 FROM pool_creators WHERE user_id = $1', [userId]);
  return allowedRows.length > 0;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Parse outside the main try: a malformed/null body used to fall into the
  // generic catch and surface as a 500 instead of a 400.
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  try {
    if (!await canCreatePools(locals.user.id)) {
      return json({ error: 'No tienes permiso para crear quinielas' }, { status: 403 });
    }

    const { name, buy_in = 0, allow_multiple_predictions = false } = body;

    if (typeof name !== 'string' || !name.trim() || name.trim().length < 2) return json({ error: 'Nombre requerido (mínimo 2 caracteres)' }, { status: 400 });
    if (name.trim().length > 100) return json({ error: 'Nombre demasiado largo (máximo 100 caracteres)' }, { status: 400 });
    const buyin = Number(buy_in);
    if (!isFinite(buyin) || buyin < 0) return json({ error: 'buy_in debe ser un número positivo' }, { status: 400 });
    // pools.buy_in is NUMERIC(10,2): anything ≥ 1e8 overflows the column and
    // surfaces as a 500 from Postgres.
    if (buyin > 99_999_999) return json({ error: 'buy_in demasiado grande' }, { status: 400 });

    const result = await createPool(name.trim(), locals.user.id, buyin, allow_multiple_predictions);
    // Creator auto-joins a new pool → their membership-scoped global board changes.
    invalidateGlobalLeaderboard();
    return json({ id: Number(result.id), invite_code: result.inviteCode });
  } catch (e) {
    console.error('[api/pools] POST error:', e);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
