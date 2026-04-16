import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Quiniela no encontrada');

  if (!locals.user) return { pool, entries: [], groupPreds: {}, bracketPreds: {}, teams: {} };

  const entries = getUserPredictions(poolId, locals.user.id) as any[];

  // Get team lookup
  const allTeams = db.prepare('SELECT id, name, flag_code, group_name FROM teams').all() as any[];
  const teams: Record<number, any> = {};
  for (const t of allTeams) teams[t.id] = t;

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};

  for (const entry of entries) {
    groupPreds[entry.id] = db.prepare(`
      SELECT group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = ?
      ORDER BY group_name
    `).all(entry.id) as any[];

    bracketPreds[entry.id] = db.prepare(`
      SELECT phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = ?
      ORDER BY phase, slot
    `).all(entry.id) as any[];
  }

  return { pool, entries, groupPreds, bracketPreds, teams };
};
