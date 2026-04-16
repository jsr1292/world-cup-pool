import { getPoolById, getUserPredictions, getGroupPredictions, getAllTeams } from '$lib/server/queries.js';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Pool not found');

  // Get ALL user predictions for this pool
  const predictions = getUserPredictions(poolId, locals.user.id) as any[];

  // Get selected entry from query param
  const selectedLabel = url.searchParams.get('entry') || '';
  const selectedPrediction = predictions.find(p => p.label === selectedLabel) || predictions[0] || null;
  const predictionId = selectedPrediction ? Number(selectedPrediction.id) : null;

  // Load group predictions
  const groupRows = predictionId ? getGroupPredictions(predictionId) as any[] : [];
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
  const bracketRows = predictionId
    ? db.prepare(`SELECT phase, slot, team_id FROM bracket_predictions WHERE prediction_id = ? ORDER BY phase, slot`).all(predictionId) as any[]
    : [];

  const existingBracket: Record<string, Record<number, number>> = {};
  for (const row of bracketRows) {
    if (!existingBracket[row.phase]) existingBracket[row.phase] = {};
    existingBracket[row.phase][row.slot] = row.team_id;
  }

  // Load all teams
  const teams = getAllTeams() as any[];
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }

  // Check deadline
  const deadline = pool.deadline_knockout ? new Date(pool.deadline_knockout as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  // Build entry list
  const entries = predictions.map(p => ({
    id: Number(p.id),
    label: p.label || 'Entrada principal',
    total_score: p.total_score || 0,
  }));

  return {
    pool,
    entries,
    selectedId: predictionId,
    selectedLabel: selectedPrediction?.label || '',
    isLocked,
    groupPredictions,
    existingBracket,
    teamsByGroup,
  };
};
