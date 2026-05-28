import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { errCode } from '$lib/server/err-code.js';
import { parseJsonBody } from '$lib/server/json-body.js';

// POST /api/admin/recalculate
// Body: { pool_id }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body || typeof parsed.body !== 'object') {
    return json({ error: 'Cuerpo inválido' }, { status: 400 });
  }
  const { pool_id } = parsed.body as { pool_id?: number };
  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  // Verify user owns this pool
  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    await calculateAllScores(pool_id);
    // §2.7 — Invalidate caches so the admin's manual recalculate is visible
    // immediately instead of after the 30-60s TTL.
    invalidateCachedPoolLeaderboard(pool_id);
    invalidateCachedPoolResults(pool_id);
    invalidateGlobalLeaderboard();
    await logAudit('recalculate', locals.user.id, 'pool', pool_id, null, null);
    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/recalculate] ${code}:`, e);
    return json({ error: 'Error al recalcular', code }, { status: 500 });
  }
};
