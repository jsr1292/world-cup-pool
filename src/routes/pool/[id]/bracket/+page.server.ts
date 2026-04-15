import { getPoolById, getUserPredictions, getGroupPredictions, getAllTeams, createPrediction } from '$lib/server/queries.js';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Pool not found');

  // Get or create prediction entry
  let predictions = getUserPredictions(poolId, locals.user.id) as any[];
  let predictionId: number;
  if (predictions.length === 0) {
    const result = createPrediction(poolId, locals.user.id) as { lastInsertRowid: unknown };
    predictionId = Number(result.lastInsertRowid);
  } else {
    predictionId = Number(predictions[0].id);
  }

  // Load group predictions
  const groupRows = getGroupPredictions(predictionId) as any[];
  const groupPredictions: Record<string, { pos1: number; pos2: number; pos3: number; pos4: number }> = {};
  for (const row of groupRows) {
    groupPredictions[row.group_name] = {
      pos1: row.position_1,
      pos2: row.position_2,
      pos3: row.position_3,
      pos4: row.position_4,
    };
  }

  // Load existing bracket predictions
  const { db } = await import('$lib/server/db.js');
  const bracketRows = db.prepare(`
    SELECT phase, slot, team_id FROM bracket_predictions
    WHERE prediction_id = ?
    ORDER BY phase, slot
  `).all(predictionId) as any[];

  const existingBracket: Record<string, Record<number, number>> = {};
  for (const row of bracketRows) {
    if (!existingBracket[row.phase]) existingBracket[row.phase] = {};
    existingBracket[row.phase][row.slot] = row.team_id;
  }

  // Load all teams grouped by group name (for team name/flag lookup)
  const teams = getAllTeams() as any[];
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }

  // Check deadline
  const deadline = pool.deadline_knockout ? new Date(pool.deadline_knockout as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  return {
    pool,
    predictionId,
    isLocked,
    groupPredictions,
    existingBracket,
    teamsByGroup,
  };
};
