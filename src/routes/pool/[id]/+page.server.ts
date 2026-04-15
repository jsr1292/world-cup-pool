import { getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions } from '$lib/server/queries.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Pool not found');

  const members = getPoolMembers(poolId);
  const leaderboard = getPoolLeaderboard(poolId);
  const scoring = getScoringConfig(poolId);
  const predictions = locals.user ? getUserPredictions(poolId, locals.user.id) : [];

  return { pool, members, leaderboard, scoring, predictions };
};
