import { errCode } from '$lib/server/err-code.js';
import { asId } from '$lib/server/json-body.js';
import { query, getClient } from '$lib/server/db.js';
import {
  invalidateCachedPoolLeaderboard,
  invalidateCachedPoolResults,
  invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { json, type RequestHandler } from '@sveltejs/kit';

// POST /api/predictions/entry/copy
// Body: { source_id, target_id }
// Copies one entry's picks onto another entry of the SAME user+pool, so a
// player with multiple bets can duplicate one and then tweak it. Overwrites the
// target. Respects the two deadlines: the group section (scorelines + derived
// standings) is only copied while deadline_group is open; the knockout section
// (bracket + final tiebreaker) only while deadline_knockout is open.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const sourceId = asId(body?.source_id) ?? 0;
  const targetId = asId(body?.target_id) ?? 0;
  if (!sourceId || !targetId) return json({ error: 'Falta source_id o target_id' }, { status: 400 });
  if (sourceId === targetId) return json({ error: 'No puedes copiar una entrada sobre sí misma' }, { status: 400 });

  try {
    // Both predictions must exist, belong to THIS user, and be in the SAME pool.
    const { rows: predRows } = await query(
      'SELECT id, user_id, pool_id FROM predictions WHERE id = ANY($1::int[])',
      [[sourceId, targetId]]
    );
    const source = predRows.find((r: any) => Number(r.id) === sourceId);
    const target = predRows.find((r: any) => Number(r.id) === targetId);
    if (!source || !target) return json({ error: 'Entrada no encontrada' }, { status: 404 });
    if (source.user_id !== locals.user.id || target.user_id !== locals.user.id) {
      return json({ error: 'No es tu entrada' }, { status: 403 });
    }
    if (Number(source.pool_id) !== Number(target.pool_id)) {
      return json({ error: 'Las entradas no son de la misma quiniela' }, { status: 400 });
    }
    const poolId = Number(source.pool_id);

    // Membership check.
    const { rows: membership } = await query(
      'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
      [poolId, locals.user.id]
    );
    if (membership.length === 0) return json({ error: 'No eres miembro de esta quiniela' }, { status: 403 });

    // Per-section deadline gating.
    const { rows: poolRows } = await query(
      'SELECT deadline_group, deadline_knockout FROM pools WHERE id = $1',
      [poolId]
    );
    const pool = poolRows[0] ?? {};
    const now = new Date();
    const groupOpen = !pool.deadline_group || new Date(pool.deadline_group) > now;
    const knockoutOpen = !pool.deadline_knockout || new Date(pool.deadline_knockout) > now;
    if (!groupOpen && !knockoutOpen) {
      return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      if (groupOpen) {
        // Group scorelines.
        await client.query('DELETE FROM match_predictions WHERE prediction_id = $1', [targetId]);
        await client.query(
          `INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score, points_earned)
           SELECT $1, match_id, home_score, away_score, 0
           FROM match_predictions WHERE prediction_id = $2`,
          [targetId, sourceId]
        );
        // Derived group standings.
        await client.query('DELETE FROM group_predictions WHERE prediction_id = $1', [targetId]);
        await client.query(
          `INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4, points_earned)
           SELECT $1, group_name, position_1, position_2, position_3, position_4, 0
           FROM group_predictions WHERE prediction_id = $2`,
          [targetId, sourceId]
        );
      }

      if (knockoutOpen) {
        // Knockout bracket.
        await client.query('DELETE FROM bracket_predictions WHERE prediction_id = $1', [targetId]);
        await client.query(
          `INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id, points_earned)
           SELECT $1, phase, slot, team_id, 0
           FROM bracket_predictions WHERE prediction_id = $2`,
          [targetId, sourceId]
        );
        // Final-score tiebreaker (UNIQUE prediction_id → replace).
        await client.query('DELETE FROM tiebreaker WHERE prediction_id = $1', [targetId]);
        await client.query(
          `INSERT INTO tiebreaker (prediction_id, home_score, away_score)
           SELECT $1, home_score, away_score
           FROM tiebreaker WHERE prediction_id = $2`,
          [targetId, sourceId]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Recompute so the target entry's total reflects the copied picks if any
    // matches have already finished (no-op pre-tournament). Best-effort.
    try {
      const { rows: anyFinished } = await query(
        "SELECT 1 FROM matches WHERE status = 'finished' LIMIT 1"
      );
      if (anyFinished.length > 0) {
        await calculateAllScores(poolId);
        invalidateCachedPoolLeaderboard(poolId);
        invalidateCachedPoolResults(poolId);
        invalidateGlobalLeaderboard();
      }
    } catch (e) {
      console.error(`[api/predictions/entry/copy] rescore ${errCode()}:`, e);
    }

    return json({ ok: true, copied: { group: groupOpen, knockout: knockoutOpen } });
  } catch (e) {
    const code = errCode();
    console.error(`[api/predictions/entry/copy] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
