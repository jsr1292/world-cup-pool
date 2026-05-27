import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw error(404, 'Quiniela no encontrada');

  if (!locals.user) return { pool, entries: [], groupPreds: {}, bracketPreds: {}, teams: {} };

  const entries = await getUserPredictions(poolId, locals.user.id) as any[];

  // Get team lookup
  const { rows: allTeams } = await query('SELECT id, name, flag_code, group_name FROM teams');
  const teams: Record<number, any> = {};
  for (const t of allTeams) teams[t.id] = t;

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};

  for (const entry of entries) {
    const { rows: gpRows } = await query(`
      SELECT group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = $1
      ORDER BY group_name
    `, [entry.id]);
    groupPreds[entry.id] = gpRows;

    const { rows: bpRows } = await query(`
      SELECT phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = $1
      ORDER BY phase, slot
    `, [entry.id]);
    bracketPreds[entry.id] = bpRows;
  }

  return { pool, entries, groupPreds, bracketPreds, teams };
};
