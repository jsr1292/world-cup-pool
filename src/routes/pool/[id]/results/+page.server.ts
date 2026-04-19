import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Quiniela no encontrada');

  // Get all matches with team names
  const matches = db.prepare(`
    SELECT m.*, 
      ht.name as home_name, ht.flag_code as home_flag, 
      at.name as away_name, at.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams ht ON ht.id = m.home_team_id
    LEFT JOIN teams at ON at.id = m.away_team_id
    ORDER BY m.sort_order, m.kickoff
  `).all() as any[];

  // Group matches by phase
  const phases: Record<string, any[]> = {};
  for (const m of matches) {
    const phase = m.phase || 'other';
    if (!phases[phase]) phases[phase] = [];
    phases[phase].push(m);
  }

  // Get user's predictions if logged in
  let userPredictions: any[] = [];
  let userGroupPreds: any[] = [];
  let userBracketPreds: any[] = [];
  let selectedEntryId: number | null = null;

  if (locals.user) {
    userPredictions = getUserPredictions(poolId, locals.user.id) as any[];
    if (userPredictions.length > 0) {
      selectedEntryId = userPredictions[0].id;

      // Group predictions
      userGroupPreds = db.prepare(`
        SELECT group_name, position_1, position_2, position_3, position_4, points_earned
        FROM group_predictions WHERE prediction_id = ?
      `).all(selectedEntryId) as any[];

      // Bracket predictions
      userBracketPreds = db.prepare(`
        SELECT phase, slot as match_index, team_id, points_earned
        FROM bracket_predictions WHERE prediction_id = ?
      `).all(selectedEntryId) as any[];
    }
  }

  // Build actual group standings from finished matches
  const groupStandings: Record<string, any[]> = {};
  const groupMatches = phases['group'] || [];
  const teamCache: Record<number, any> = {};
  for (const m of groupMatches) {
    if (m.home_team_id) teamCache[m.home_team_id] = { name: m.home_name, flag_code: m.home_flag };
    if (m.away_team_id) teamCache[m.away_team_id] = { name: m.away_name, flag_code: m.away_flag };
  }

  const standings: Record<string, Record<number, { pts: number; gf: number; ga: number }>> = {};
  for (const m of groupMatches) {
    if (m.status !== 'finished' || m.home_score == null) continue;
    if (!m.group_name) continue;
    if (!standings[m.group_name]) standings[m.group_name] = {};
    const gs = standings[m.group_name];
    if (!gs[m.home_team_id]) gs[m.home_team_id] = { pts: 0, gf: 0, ga: 0 };
    if (!gs[m.away_team_id]) gs[m.away_team_id] = { pts: 0, gf: 0, ga: 0 };
    const h = gs[m.home_team_id], a = gs[m.away_team_id];
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;
    if (m.home_score > m.away_score) h.pts += 3;
    else if (m.home_score < m.away_score) a.pts += 3;
    else { h.pts += 1; a.pts += 1; }
  }

  for (const [group, teams] of Object.entries(standings)) {
    const sorted = Object.entries(teams)
      .map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga, ...teamCache[Number(id)] }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    groupStandings[group] = sorted;
  }

  return {
    pool,
    phases,
    groupStandings,
    userPredictions,
    selectedEntryId,
    userGroupPreds,
    userBracketPreds,
    teamCache,
  };
};
