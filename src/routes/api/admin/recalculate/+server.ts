import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';

// POST /api/admin/recalculate
// Body: { pool_id }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const { pool_id } = await request.json() as { pool_id: number };

  // Verify user owns this pool
  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  try {
    await calculateAllScores(pool_id);
    await logAudit('recalculate', locals.user.id, 'pool', pool_id, null, null);
    return json({ ok: true });
  } catch (e) {
    console.error('Recalculate error:', e);
    return json({ error: 'Error al recalcular' }, { status: 500 });
  }
};
