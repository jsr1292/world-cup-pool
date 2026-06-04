import { getPoolById, getAllTeams, createPrediction, getUserPredictions, getScoringConfig } from '$lib/server/queries.js';
import { DEFAULT_SCORING_RULES } from '$lib/server/scoring.js';
import { query } from '$lib/server/db.js';
import { redirect, error } from '@sveltejs/kit';
import type { ServerLoad } from '@sveltejs/kit';

export const load: ServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw redirect(302, '/login');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // Membership gate (IDOR §1.2)
  const { rows: m } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (m.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  // Effective scoring rules (defaults + this pool's overrides) so the intro can
  // show the real per-result value and the optional table-position bonus.
  const scoring = { ...DEFAULT_SCORING_RULES, ...(await getScoringConfig(poolId)) } as Record<string, number>;

  const teams = await getAllTeams() as any[];

  // Group teams by group_name — skip teams with no group assigned
  const teamsByGroup: Record<string, any[]> = {};
  for (const team of teams) {
    if (!team.group_name) continue;
    if (!teamsByGroup[team.group_name]) teamsByGroup[team.group_name] = [];
    teamsByGroup[team.group_name].push(team);
  }
  const presentGroups = Object.keys(teamsByGroup).sort();

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

  // Check deadline (group deadline for group predictions)
  const deadline = pool.deadline_group ? new Date(pool.deadline_group as string) : null;
  const isLocked = deadline ? new Date() >= deadline : false;

  // Get selected prediction from query param or first one
  const selectedLabel = url.searchParams.get('entry') || '';
  // §7.3 — Match labels case-insensitively (mirrors the uppercase normalization
  // used elsewhere). Two entries differing only in case would otherwise be
  // unselectable.
  const selectedNorm = selectedLabel?.toLowerCase() ?? '';
  let selectedPrediction = predictions.find(p => (p.label ?? '').toLowerCase() === selectedNorm) || predictions[0] || null;
  let selectedId: number | null = null;

  // Load the 72 group matches (always have both teams from the seed). The group
  // stage is predicted as scorelines now; the standings table is derived from
  // them client-side for preview and server-side on save.
  const { rows: groupMatches } = await query(`
    SELECT m.id, m.group_name, m.matchday, m.sort_order, m.status, m.kickoff_time,
      m.home_team_id, m.away_team_id,
      ht.name as home_name, ht.flag_code as home_flag,
      at.name as away_name, at.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    WHERE m.phase = 'group' AND m.group_name IS NOT NULL
    ORDER BY m.group_name, m.kickoff_time ASC NULLS LAST, m.matchday, m.sort_order, m.id
  `);
  // Per-match lock: a group match locks individually once it kicks off (or is
  // finished), so earlier rounds locking doesn't freeze a group's later games.
  const now = Date.now();
  const groupMatchesByGroup: Record<string, any[]> = {};
  for (const m of groupMatches) {
    const ko = m.kickoff_time ? new Date(m.kickoff_time) : null;
    const locked = m.status === 'finished' || (ko != null && ko.getTime() <= now);
    (groupMatchesByGroup[m.group_name] ??= []).push({
      ...m,
      kickoff: ko ? ko.toISOString() : null,
      locked,
    });
  }

  // Load existing match predictions (group scorelines) for the selected entry —
  // these seed the score inputs and the live derived-standings preview.
  const existingMatchPreds: Record<number, { home_score: number; away_score: number }> = {};
  // Stored group-table order per group (encodes any manual tiebreak the player
  // set). Seeds the live preview so the client and the saved bracket agree.
  const groupOrders: Record<string, number[]> = {};

  if (selectedPrediction) {
    selectedId = Number(selectedPrediction.id);
    const { rows: mpRows } = await query(`
      SELECT match_id, home_score, away_score
      FROM match_predictions WHERE prediction_id = $1
    `, [selectedId]);
    for (const row of mpRows) {
      existingMatchPreds[row.match_id] = { home_score: row.home_score, away_score: row.away_score };
    }
    const { rows: gpRows } = await query(`
      SELECT group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = $1
    `, [selectedId]);
    for (const r of gpRows) {
      groupOrders[r.group_name] = [r.position_1, r.position_2, r.position_3, r.position_4]
        .filter((x: number | null) => x != null);
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
    presentGroups,
    entries,
    selectedId,
    selectedLabel: selectedPrediction?.label || '',
    isLocked,
    groupMatchesByGroup,
    existingMatchPreds,
    groupOrders,
    scoring,
  };
};
