import { getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Pool not found');

  const members = getPoolMembers(poolId);
  const leaderboard = getPoolLeaderboard(poolId);
  const scoring = getScoringConfig(poolId);
  const predictions = locals.user ? getUserPredictions(poolId, locals.user.id) : [];

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
  };
};
