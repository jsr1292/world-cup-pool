import { query } from '$lib/server/db.js';
import { getPoolById, getPoolMembers, getScoringConfig } from '$lib/server/queries.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'No autorizado');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  if (pool.created_by !== locals.user.id) {
    throw error(403, 'Solo el creador puede acceder al admin');
  }

  const members = await getPoolMembers(poolId);
  const scoring = await getScoringConfig(poolId);

  // Get group stage matches
  const { rows: matches } = await query(`
    SELECT m.*, t1.name as home_name, t1.flag_code as home_flag, 
           t2.name as away_name, t2.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams t1 ON t1.id = m.home_team_id
    LEFT JOIN teams t2 ON t2.id = m.away_team_id
    WHERE m.phase = 'group'
    ORDER BY m.group_name, m.sort_order, m.kickoff
  `);

  // Stats
  const { rows: tpRows } = await query('SELECT COUNT(*) as c FROM predictions WHERE pool_id = $1', [poolId]);
  const { rows: tmRows } = await query("SELECT COUNT(*) as c FROM matches WHERE phase = 'group'");
  const { rows: fmRows } = await query("SELECT COUNT(*) as c FROM matches WHERE phase = 'group' AND status = 'finished'");

  const stats = {
    totalMembers: members.length,
    totalPaid: (members as any[]).filter(m => m.has_paid).length,
    totalPredictions: tpRows[0].c,
    totalMatches: tmRows[0].c,
    finishedMatches: fmRows[0].c,
  };

  return { pool, members, scoring, matches, stats };
};
