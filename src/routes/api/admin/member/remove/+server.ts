import { query, getClient } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';
import { logAudit } from '$lib/server/audit.js';
import { invalidateCachedPoolLeaderboard, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

// POST /api/admin/member/remove
// Body: { pool_id, user_id }
// Removes a member from ONE pool: deletes their predictions in that pool (which
// cascades to match/group/bracket/tiebreaker rows) and their pool_members row.
// Scoped to the pool — the user's account and any other pools are untouched.
// Creator OR site admin only; the pool creator cannot be removed.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { pool_id, user_id } = parsed.body as { pool_id?: number; user_id?: number };

    if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
    if (!user_id) return json({ error: 'Falta user_id' }, { status: 400 });

    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    // Creator OR site admin can manage members (matches /api/admin/payment).
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    // The pool owner can't be removed from their own pool.
    if (pool.created_by === user_id) {
      return json({ error: 'No puedes eliminar al creador de la quiniela' }, { status: 400 });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');
      // predictions → match_predictions/group_predictions/bracket_predictions/
      // tiebreaker all cascade via ON DELETE CASCADE (migration 0001).
      await client.query('DELETE FROM predictions WHERE pool_id = $1 AND user_id = $2', [pool_id, user_id]);
      const res = await client.query('DELETE FROM pool_members WHERE pool_id = $1 AND user_id = $2', [pool_id, user_id]);
      await client.query('COMMIT');

      if (res.rowCount === 0) {
        // Nothing was a member — surface a 404 so the UI can react.
        return json({ error: 'El usuario no es miembro de esta quiniela' }, { status: 404 });
      }
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Their entry leaves the standings; drop the cached leaderboards.
    invalidateCachedPoolLeaderboard(pool_id);
    invalidateGlobalLeaderboard();
    await logAudit('remove_member', locals.user.id, 'pool', pool_id, null, { removed_user_id: user_id });

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/member/remove] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
