import { getPoolById, getAllTeams, createPrediction, getUserPredictions, getGroupPredictions } from '$lib/server/queries.js';
import { redirect, error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Pool not found');

  const teams = getAllTeams() as any[];

  // Group teams by group_name
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }

  // Get ALL user predictions for this pool
  let predictions = getUserPredictions(poolId, locals.user.id) as any[];

  // Check deadline
  const deadline = pool.deadline_group ? new Date(pool.deadline_group as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  // Get selected prediction from query param or first one
  const selectedLabel = url.searchParams.get('entry') || '';
  let selectedPrediction = predictions.find(p => p.label === selectedLabel) || predictions[0] || null;
  let selectedId: number | null = null;

  // Load group predictions for selected entry
  const existingGroupPreds: Record<string, { pos1?: number; pos2?: number; pos3?: number; pos4?: number }> = {};

  if (selectedPrediction) {
    selectedId = Number(selectedPrediction.id);
    const rows = getGroupPredictions(selectedId) as any[];
    for (const row of rows) {
      existingGroupPreds[row.group_name] = {
        pos1: row.position_1,
        pos2: row.position_2,
        pos3: row.position_3,
        pos4: row.position_4,
      };
    }
  }

  // Build entry list for dropdown (show labels)
  const entries = predictions.map(p => ({
    id: Number(p.id),
    label: p.label || 'Entrada principal',
    total_score: p.total_score || 0,
  }));

  return {
    pool,
    teamsByGroup,
    entries,
    selectedId,
    selectedLabel: selectedPrediction?.label || '',
    isLocked,
    existingGroupPreds,
  };
};
