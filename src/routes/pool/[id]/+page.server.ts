import { getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Quiniela no encontrada');

  const members = getPoolMembers(poolId);
  const leaderboard = getPoolLeaderboard(poolId);
  const scoring = getScoringConfig(poolId);
  const predictions = locals.user ? getUserPredictions(poolId, locals.user.id) : [];

  // Summary data
  const allTeams = db.prepare('SELECT id, name, flag_code, group_name FROM teams').all() as any[];
  const teams: Record<number, any> = {};
  for (const t of allTeams) teams[t.id] = t;

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};
  for (const entry of predictions) {
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

  // Enrich leaderboard with per-phase correct pick counts
  const enrichedLeaderboard = leaderboard.map((entry: any) => {
    const predId = entry.id;

    // Correct group positions
    const groupCorrect = (db.prepare(`
      SELECT COUNT(*) as cnt FROM group_predictions
      WHERE prediction_id = ? AND points_earned > 0
    `).get(predId) as any).cnt;

    // Correct bracket picks per phase
    const bracketByPhase: Record<string, number> = {};
    const bracketRows = db.prepare(`
      SELECT phase, points_earned FROM bracket_predictions WHERE prediction_id = ?
    `).all(predId) as any[];
    for (const br of bracketRows) {
      if (br.points_earned > 0) {
        bracketByPhase[br.phase] = (bracketByPhase[br.phase] || 0) + 1;
      }
    }

    return {
      ...entry,
      group_correct: groupCorrect,
      bracket_correct: bracketByPhase,
      total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
    };
  });

  // Sort: total_score DESC, then total_correct DESC
  enrichedLeaderboard.sort((a: any, b: any) => b.total_score - a.total_score || b.total_correct - a.total_correct);

  return {
    pool, members, leaderboard: enrichedLeaderboard, scoring, predictions,
    isAdmin: locals.user ? (pool as any).created_by === locals.user.id : false,
    userId: locals.user?.id ?? null,
    teams,
    groupPreds,
    bracketPreds,
  };
};
