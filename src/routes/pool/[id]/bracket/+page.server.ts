import { getPoolById, getUserPredictions, getGroupPredictions, getAllTeams, createPrediction, resolveSelectedPrediction } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  // Get ALL user predictions for this pool
  let predictions = await getUserPredictions(poolId, locals.user.id) as any[];

  // Auto-create first prediction entry if user is a member with none yet
  if (predictions.length === 0) {
    const { rows: membership } = await query(
      `SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2`,
      [poolId, locals.user.id]
    );
    if (membership.length > 0) {
      await createPrediction(poolId, locals.user.id, '');
      predictions = await getUserPredictions(poolId, locals.user.id) as any[];
    }
  }

  // Get selected entry from query param (id-preferred, label fallback) — shared
  // resolver, identical to the predict/results stages.
  const selectedPrediction = resolveSelectedPrediction(predictions, url.searchParams.get('entry'));
  const predictionId = selectedPrediction ? Number(selectedPrediction.id) : null;

  // Load group predictions
  const groupRows = predictionId ? await getGroupPredictions(predictionId) as any[] : [];
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
  let bracketRows: any[] = [];
  if (predictionId) {
    const { rows } = await query('SELECT phase, slot, team_id FROM bracket_predictions WHERE prediction_id = $1 ORDER BY phase, slot', [predictionId]);
    bracketRows = rows;
  }

  const existingBracket: Record<string, Record<number, number>> = {};
  for (const row of bracketRows) {
    if (!existingBracket[row.phase]) existingBracket[row.phase] = {};
    existingBracket[row.phase][row.slot] = row.team_id;
  }

  // Load all teams
  const teams = await getAllTeams() as any[];
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
