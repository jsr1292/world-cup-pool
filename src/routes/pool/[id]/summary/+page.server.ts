import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { isEmailConfigured } from '$lib/server/email.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // #3 — Membership/creator gate (mirror the sibling pool pages). Without it,
  // any authenticated user could load another pool's summary and read its
  // invite_code / share_token from the serialized page data.
  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  // #3 — Never serialize sensitive columns (invite_code, share_token) to the
  // client; return only the fields the page needs.
  const safePool = {
    id: pool.id,
    name: pool.name,
    buy_in: pool.buy_in,
    currency: pool.currency,
    is_active: pool.is_active,
    created_by: pool.created_by,
    allow_multiple_predictions: pool.allow_multiple_predictions,
    deadline_group: pool.deadline_group,
    deadline_knockout: pool.deadline_knockout,
  };

  const entries = await getUserPredictions(poolId, locals.user.id) as any[];

  // H-04: Bulk-fetch teams and predictions (no N+1 loop)
  const teams = await getTeamsMapCached();

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};

  if (entries.length > 0) {
    const predIds = entries.map((e: any) => e.id);

    const { rows: allGP } = await query(`
      SELECT prediction_id, group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY group_name
    `, [predIds]);
    for (const gp of allGP) {
      if (!groupPreds[gp.prediction_id]) groupPreds[gp.prediction_id] = [];
      groupPreds[gp.prediction_id].push(gp);
    }

    const { rows: allBP } = await query(`
      SELECT prediction_id, phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY phase, slot
    `, [predIds]);
    for (const bp of allBP) {
      if (!bracketPreds[bp.prediction_id]) bracketPreds[bp.prediction_id] = [];
      bracketPreds[bp.prediction_id].push(bp);
    }

    // Fill empty arrays for entries with no predictions
    for (const entry of entries) {
      if (!groupPreds[entry.id]) groupPreds[entry.id] = [];
      if (!bracketPreds[entry.id]) bracketPreds[entry.id] = [];
    }
  }

  return {
    pool: safePool, entries, groupPreds, bracketPreds, teams,
    emailEnabled: isEmailConfigured() && !!locals.user.email,
  };
};
