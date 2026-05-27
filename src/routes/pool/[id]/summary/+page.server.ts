import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  if (!locals.user) return { pool, entries: [], groupPreds: {}, bracketPreds: {}, teams: {} };

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

  return { pool, entries, groupPreds, bracketPreds, teams };
};
