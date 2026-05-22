import { getPoolById, getPoolMembers, getPoolLeaderboard, getScoringConfig, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached, getCachedPoolResults, setCachedPoolResults } from '$lib/server/cache.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  const poolId = Number(params.id);
  const pool = await getPoolById(poolId);
  if (!pool) throw new Error('Quiniela no encontrada');

  const members = await getPoolMembers(poolId);
  const leaderboard = await getPoolLeaderboard(poolId);
  const scoring = await getScoringConfig(poolId);
  const predictions = locals.user ? await getUserPredictions(poolId, locals.user.id) : [];

  // F-15: Use cached teams map instead of querying teams table
  const teams = await getTeamsMapCached();

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};

  if (predictions.length > 0) {
    const predIds = predictions.map((e: any) => e.id);
    const { rows: allGP } = await query(`
      SELECT prediction_id, group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY group_name
    `, [predIds]);
    for (const gp of allGP) {
      if (!groupPreds[gp.prediction_id]) groupPreds[gp.prediction_id] = [];
      groupPreds[gp.prediction_id].push(gp);
    }

    const { rows: allBP } = await query(`
      SELECT prediction_id, phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY phase, slot
    `, [predIds]);
    for (const bp of allBP) {
      if (!bracketPreds[bp.prediction_id]) bracketPreds[bp.prediction_id] = [];
      bracketPreds[bp.prediction_id].push(bp);
    }

    // Fill empty arrays for predictions with no group/bracket data
    for (const entry of predictions) {
      if (!groupPreds[entry.id]) groupPreds[entry.id] = [];
      if (!bracketPreds[entry.id]) bracketPreds[entry.id] = [];
    }
  }

  // Get actual final match score for tiebreaker closeness
  const { rows: fmRows } = await query(`
    SELECT home_score, away_score FROM matches
    WHERE phase = 'final' AND status = 'finished' AND home_score IS NOT NULL
    LIMIT 1
  `);
  const finalMatch = fmRows[0] ?? null;

  // F-06: Bulk-fetch enrichment data to eliminate N+1 queries in leaderboard loop
  const predIds = leaderboard.map((e: any) => e.id);
  let groupCorrectMap: Record<number, number> = {};
  let bracketByPredPhase: Record<number, Record<string, number>> = {};
  let tiebreakerMap: Record<number, any> = {};

  if (predIds.length > 0) {
    const { rows: gcRows } = await query(`
      SELECT prediction_id, COUNT(*) as cnt
      FROM group_predictions
      WHERE prediction_id = ANY($1::int[]) AND points_earned > 0
      GROUP BY prediction_id
    `, [predIds]);
    gcRows.forEach((r: any) => { groupCorrectMap[r.prediction_id] = r.cnt; });

    const { rows: brRows } = await query(`
      SELECT prediction_id, phase, points_earned
      FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
    `, [predIds]);
    brRows.forEach((br: any) => {
      if (br.points_earned > 0) {
        if (!bracketByPredPhase[br.prediction_id]) bracketByPredPhase[br.prediction_id] = {};
        bracketByPredPhase[br.prediction_id][br.phase] = (bracketByPredPhase[br.prediction_id][br.phase] || 0) + 1;
      }
    });

    const { rows: tbRows } = await query(`
      SELECT prediction_id, home_score, away_score
      FROM tiebreaker WHERE prediction_id = ANY($1::int[])
    `, [predIds]);
    tbRows.forEach((tb: any) => { tiebreakerMap[tb.prediction_id] = tb; });
  }

  const enrichedLeaderboard = leaderboard.map((entry: any) => {
    const predId = entry.id;
    const groupCorrect = groupCorrectMap[predId] ?? 0;
    const bracketByPhase = bracketByPredPhase[predId] ?? {};
    let tiebreakerClose = 9999;
    if (finalMatch) {
      const tb = tiebreakerMap[predId];
      if (tb?.home_score != null && tb?.away_score != null) {
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

  // F-20: Cache results data (phases, team cache, group standings)
  let resultsPhases: Record<string, any[]>;
  let resultsTeamCache: Record<number, any>;
  let resultsGroupStandings: Record<string, any[]>;

  const cachedResults = getCachedPoolResults(pool.id);
  if (cachedResults) {
    ({ resultsPhases, resultsTeamCache, resultsGroupStandings } = cachedResults);
  } else {
    const { rows: matchRows } = await query(`
      SELECT m.*, ht.name as home_name, ht.flag_code as home_flag,
        at.name as away_name, at.flag_code as away_flag
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      ORDER BY m.sort_order, m.kickoff
    `);
    resultsPhases = (() => {
      const phases: Record<string, any[]> = {};
      for (const m of matchRows) {
        const phase = m.phase || 'other';
        if (!phases[phase]) phases[phase] = [];
        phases[phase].push(m);
      }
      return phases;
    })();
    resultsTeamCache = await getTeamsMapCached();
    const { rows: groupMatchRows } = await query(`
      SELECT m.*, ht.name as home_name, ht.flag_code as home_flag,
        at.name as away_name, at.flag_code as away_flag
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      WHERE m.phase = 'group'
    `);
    resultsGroupStandings = (() => {
      const standings: Record<string, Record<number, { pts: number; gf: number; ga: number }>> = {};
      const cache: Record<number, any> = {};
      for (const m of groupMatchRows) {
        if (m.home_team_id) cache[m.home_team_id] = { name: m.home_name, flag_code: m.home_flag };
        if (m.away_team_id) cache[m.away_team_id] = { name: m.away_name, flag_code: m.away_flag };
      }
      for (const m of groupMatchRows) {
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
    })();
    setCachedPoolResults(pool.id, { resultsPhases, resultsTeamCache, resultsGroupStandings });
  }

  // User full predictions
  let userGroupPredsFull: any[] = [];
  let userBracketPredsFull: any[] = [];
  if (predictions.length > 0) {
    const { rows: ugpRows } = await query(`
      SELECT group_name, position_1, position_2, position_3, position_4, points_earned
      FROM group_predictions WHERE prediction_id = $1
    `, [predictions[0].id]);
    userGroupPredsFull = ugpRows;

    const { rows: ubpRows } = await query(`
      SELECT phase, slot as match_index, team_id, points_earned
      FROM bracket_predictions WHERE prediction_id = $1
    `, [predictions[0].id]);
    userBracketPredsFull = ubpRows;
  }

  return {
    pool, members, leaderboard: enrichedLeaderboard, scoring, predictions,
    isAdmin: locals.user ? (pool as any).created_by === locals.user.id : false,
    userId: locals.user?.id ?? null,
    teams,
    groupPreds,
    bracketPreds,
    deadlinePassed: (!!((pool as any).deadline_group) && new Date((pool as any).deadline_group) <= new Date()) ||
                    (!!((pool as any).deadline_knockout) && new Date((pool as any).deadline_knockout) <= new Date()),
    resultsPhases,
    resultsTeamCache,
    resultsGroupStandings,
    userGroupPredsFull,
    userBracketPredsFull,
  };
};
