import { getPoolById, getAllTeams, createPrediction, getUserPredictions, getGroupPredictions } from '$lib/server/queries.js';
import { redirect } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw new Error('Pool not found');

  const teams = getAllTeams() as any[];

  // Group teams by group_name
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }

  // Get or create prediction entry
  let predictions = getUserPredictions(poolId, locals.user.id) as any[];
  let predictionId: number | null = null;
  const existingGroupPreds: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};

  if (predictions.length === 0) {
    // Auto-create prediction entry
    const result = createPrediction(poolId, locals.user.id) as { lastInsertRowid: unknown };
    predictionId = Number(result.lastInsertRowid);
    predictions = [{ id: predictionId }];
  } else {
    predictionId = Number(predictions[0].id);
    // Load existing group predictions
    const rows = getGroupPredictions(predictionId) as any[];
    for (const row of rows) {
      existingGroupPreds[row.group_name] = {
        pos1: row.position_1,
        pos2: row.position_2,
        pos3: row.position_3,
        pos4: row.position_4,
      };
    }
  }

  // Check deadline
  const deadline = pool.deadline_group ? new Date(pool.deadline_group as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  return {
    pool,
    teamsByGroup,
    predictionId,
    isLocked,
    existingGroupPreds,
  };
};
