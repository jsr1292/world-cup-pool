import { getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = getPoolById(poolId);
  if (!pool) throw new Error('Quiniela no encontrada');

  const members = getPoolMembers(poolId);
  const leaderboard = getPoolLeaderboard(poolId);
  const scoring = getScoringConfig(poolId);
  const predictions = locals.user ? getUserPredictions(poolId, locals.user.id) : [];

  // Summary data
  const allTeams = db.prepare('SELECT id, name, flag_code, group_name FROM teams').all() as any[];
  const teams: Record<number, any> = {};
  for (const t of allTeams) teams[t.id] = t;

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};
  for (const entry of predictions) {
    groupPreds[entry.id] = db.prepare(`
      SELECT group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = ?
      ORDER BY group_name
    `).all(entry.id) as any[];
    bracketPreds[entry.id] = db.prepare(`
      SELECT phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = ?
      ORDER BY phase, slot
    `).all(entry.id) as any[];
  }

  // Get actual final match score for tiebreaker closeness
  const finalMatch = db.prepare(`
    SELECT home_score, away_score FROM matches
    WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
    LIMIT 1
  `).get() as any;

  // Enrich leaderboard with per-phase correct pick counts + tiebreaker closeness
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

    // Tiebreaker closeness: smaller = better
    let tiebreakerClose = 9999;
    if (finalMatch) {
      const tb = db.prepare(`
        SELECT home_score, away_score FROM tiebreaker WHERE prediction_id = ?
      `).get(predId) as any;
      if (tb && tb.home_score != null && tb.away_score != null) {
        tiebreakerClose = Math.abs(tb.home_score - finalMatch.home_score) + Math.abs(tb.away_score - finalMatch.away_score);
      }
    }

    return {
      ...entry,
      group_correct: groupCorrect,
      bracket_correct: bracketByPhase,
      total_correct: groupCorrect + Object.values(bracketByPhase).reduce((a: number, b: number) => a + b, 0),
      tiebreaker_close: tiebreakerClose,
    };
  });

  // Sort: total_score DESC, then total_correct DESC, then tiebreaker closeness ASC
  enrichedLeaderboard.sort((a: any, b: any) =>
    b.total_score - a.total_score || b.total_correct - a.total_correct || a.tiebreaker_close - b.tiebreaker_close
  );

  return {
    pool, members, leaderboard: enrichedLeaderboard, scoring, predictions,
    isAdmin: locals.user ? (pool as any).created_by === locals.user.id : false,
    userId: locals.user?.id ?? null,
    teams,
    groupPreds,
    bracketPreds,
    deadlinePassed: !!(pool as any).deadline_group && new Date((pool as any).deadline_group) <= new Date(),

    // Results data
    resultsPhases: (() => {
      const matches = db.prepare(`
        SELECT m.*, ht.name as home_name, ht.flag_code as home_flag,
          at.name as away_name, at.flag_code as away_flag
        FROM matches m
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        ORDER BY m.sort_order, m.kickoff
      `).all() as any[];
      const phases: Record<string, any[]> = {};
      for (const m of matches) {
        const phase = m.phase || 'other';
        if (!phases[phase]) phases[phase] = [];
        phases[phase].push(m);
      }
      return phases;
    })(),
    resultsTeamCache: (() => {
      const ts = db.prepare('SELECT id, name, flag_code FROM teams').all() as any[];
      const cache: Record<number, any> = {};
      for (const t of ts) cache[t.id] = t;
      return cache;
    })(),
    resultsGroupStandings: (() => {
      const groupMatches = db.prepare(`
        SELECT m.*, ht.name as home_name, ht.flag_code as home_flag,
          at.name as away_name, at.flag_code as away_flag
        FROM matches m
        LEFT JOIN teams ht ON ht.id = m.home_team_id
        LEFT JOIN teams at ON at.id = m.away_team_id
        WHERE m.phase = 'group'
      `).all() as any[];
      const standings: Record<string, Record<number, { pts: number; gf: number; ga: number }>> = {};
      const cache: Record<number, any> = {};
      for (const m of groupMatches) {
        if (m.home_team_id) cache[m.home_team_id] = { name: m.home_name, flag_code: m.home_flag };
        if (m.away_team_id) cache[m.away_team_id] = { name: m.away_name, flag_code: m.away_flag };
      }
      for (const m of groupMatches) {
        if (m.status !== 'finished' || m.home_score == null || !m.group_name) continue;
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
      const result: Record<string, any[]> = {};
      for (const [group, teams] of Object.entries(standings)) {
        result[group] = Object.entries(teams)
          .map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga, ...cache[Number(id)] }))
          .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
      }
      return result;
    })(),
    userGroupPredsFull: predictions.length > 0 ? db.prepare(`
      SELECT group_name, position_1, position_2, position_3, position_4, points_earned
      FROM group_predictions WHERE prediction_id = ?
    `).all(predictions[0].id) as any[] : [],
    userBracketPredsFull: predictions.length > 0 ? db.prepare(`
      SELECT phase, slot as match_index, team_id, points_earned
      FROM bracket_predictions WHERE prediction_id = ?
    `).all(predictions[0].id) as any[] : [],
  };
};
