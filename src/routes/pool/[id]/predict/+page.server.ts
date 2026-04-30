import { getPoolById, getAllTeams, createPrediction, getUserPredictions, getGroupPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import { redirect, error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const teams = getAllTeams() as any[];

  // Group teams by group_name
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }

  // Get ALL user predictions for this pool
  let predictions = getUserPredictions(poolId, locals.user.id) as any[];

  // Check deadline (group deadline for group predictions)
  const deadline = pool.deadline_group ? new Date(pool.deadline_group as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  // Get selected prediction from query param or first one
  const selectedLabel = url.searchParams.get('entry') || '';
  let selectedPrediction = predictions.find(p => p.label === selectedLabel) || predictions[0] || null;
  let selectedId: number | null = null;

  // Load knockout matches with both teams set (available for prediction)
  const knockoutMatches = db.prepare(`
    SELECT m.id, m.phase, m.home_team_id, m.away_team_id,
      ht.name as home_name, ht.flag_code as home_flag,
      at.name as away_name, at.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.phase IN ('r32','r16','qf','sf','3rd','final')
      AND m.home_team_id IS NOT NULL
      AND m.away_team_id IS NOT NULL
    ORDER BY m.phase, m.id
  `).all() as any[];

  // Group knockout matches by phase
  const knockoutByPhase: Record<string, any[]> = {};
  for (const m of knockoutMatches) {
    if (!knockoutByPhase[m.phase]) knockoutByPhase[m.phase] = [];
    knockoutByPhase[m.phase].push(m);
  }

  // Load existing match predictions
  const existingMatchPreds: Record<number, { home_score: number; away_score: number }> = {};

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
    // Load existing match predictions
    const mpRows = db.prepare(`
      SELECT match_id, home_score, away_score
      FROM match_predictions WHERE prediction_id = ?
    `).all(selectedId) as any[];
    for (const row of mpRows) {
      existingMatchPreds[row.match_id] = { home_score: row.home_score, away_score: row.away_score };
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
    knockoutByPhase,
    existingMatchPreds,
  };
};
