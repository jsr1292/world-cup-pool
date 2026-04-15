import { db } from '$lib/server/db.js';
import { getPoolById, getPoolMembers, getScoringConfig } from '$lib/server/queries.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Unauthorized');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Pool not found');

  if (pool.created_by !== locals.user.id) {
    throw error(403, 'Only the pool creator can access admin');
  }

  const members = getPoolMembers(poolId);
  const scoring = getScoringConfig(poolId);

  // Get group stage matches
  const matches = db.prepare(`
    SELECT m.*, t1.name as home_name, t1.flag_code as home_flag, 
           t2.name as away_name, t2.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams t1 ON t1.id = m.home_team_id
    LEFT JOIN teams t2 ON t2.id = m.away_team_id
    WHERE m.phase = 'group'
    ORDER BY m.group_name, m.sort_order, m.kickoff
  `).all();

  // Stats
  const stats = {
    totalMembers: members.length,
    totalPaid: (members as any[]).filter(m => m.has_paid).length,
    totalPredictions: (db.prepare('SELECT COUNT(*) as c FROM predictions WHERE pool_id = ?').get(poolId) as any).c,
    totalMatches: (db.prepare('SELECT COUNT(*) as c FROM matches WHERE phase = \'group\'').get() as any).c,
    finishedMatches: (db.prepare('SELECT COUNT(*) as c FROM matches WHERE phase = \'group\' AND status = \'finished\'').get() as any).c,
  };

  return { pool, members, scoring, matches, stats };
};
