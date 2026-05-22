import { query, getClient } from './db.js';

const DEFAULT_RULES: Record<string, number> = {
  match_outcome: 1,
  exact_score: 3,
  group_position: 2,
  knockout_r32: 2,
  knockout_r16: 3,
  knockout_qf: 4,
  knockout_sf: 6,
  knockout_final: 6,
  knockout_winner: 8,
  third_place: 25,
};

export async function getScoringRules(poolId: number): Promise<Record<string, number>> {
  const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
  if (rows.length === 0) return { ...DEFAULT_RULES };
  const config: Record<string, number> = {};
  for (const row of rows) config[row.rule] = row.points;
  return config;
}

/**
 * Calculate group stage scores for all predictions in a pool.
 * Compares each user's predicted group positions against actual match results.
 */
export async function calculateGroupScores(poolId: number): Promise<void> {
  const rules = await getScoringRules(poolId);
  const ptsPerPosition = rules.group_position ?? 3;

  // Get all finished group matches
  const { rows: matches } = await query(`
    SELECT group_name, home_team_id, away_team_id, home_score, away_score
    FROM matches WHERE phase = 'group' AND status = 'finished' AND home_score IS NOT NULL
  `);

  if (matches.length === 0) return;

  // Build actual group standings from match results
  const standings: Record<string, Record<number, { points: number; gf: number; ga: number }>> = {};
  for (const m of matches) {
    if (!m.group_name) continue;
    if (!standings[m.group_name]) standings[m.group_name] = {};
    const gs = standings[m.group_name];
    if (!gs[m.home_team_id]) gs[m.home_team_id] = { points: 0, gf: 0, ga: 0 };
    if (!gs[m.away_team_id]) gs[m.away_team_id] = { points: 0, gf: 0, ga: 0 };

    const h = gs[m.home_team_id];
    const a = gs[m.away_team_id];
    h.gf += m.home_score; h.ga += m.away_score;
    a.gf += m.away_score; a.ga += m.home_score;

    if (m.home_score > m.away_score) { h.points += 3; }
    else if (m.home_score < m.away_score) { a.points += 3; }
    else { h.points += 1; a.points += 1; }
  }

  // Rank teams per group (by points, then GD, then GF)
  const actualPositions: Record<string, number[]> = {}; // group -> [pos1_teamId, pos2, pos3, pos4]
  for (const [group, teams] of Object.entries(standings)) {
    const sorted = Object.entries(teams)
      .map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga }))
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    actualPositions[group] = sorted.map(t => t.id);
  }

  // Bulk fetch all group predictions for this pool (F-03: eliminate N+1)
  const { rows: allGP } = await query(`
    SELECT gp.prediction_id, gp.group_name, gp.position_1, gp.position_2, gp.position_3, gp.position_4
    FROM group_predictions gp
    JOIN predictions p ON p.id = gp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allGP.length === 0) return;

  const gpByPred: Record<number, any[]> = {};
  for (const gp of allGP) {
    if (!gpByPred[gp.prediction_id]) gpByPred[gp.prediction_id] = [];
    gpByPred[gp.prediction_id].push(gp);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [predIdStr, gpRows] of Object.entries(gpByPred)) {
      const predId = Number(predIdStr);
      for (const gp of gpRows) {
        const actual = actualPositions[gp.group_name];
        if (!actual) continue;

        let earned = 0;
        const predicted = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
        for (let i = 0; i < 4; i++) {
          if (predicted[i] && actual[i] === predicted[i]) {
            earned += ptsPerPosition;
          }
        }
        await client.query(
          'UPDATE group_predictions SET points_earned = $1 WHERE prediction_id = $2 AND group_name = $3',
          [earned, predId, gp.group_name]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Calculate knockout bracket scores for all predictions in a pool.
 * Compares predicted bracket picks against actual match winners.
 */
export async function calculateBracketScores(poolId: number): Promise<void> {
  const rules = await getScoringRules(poolId);

  // Get all finished knockout matches
  const { rows: matches } = await query(`
    SELECT id, phase, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE phase IN ('r32','r16','qf','sf','final','3rd')
      AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
  `);

  if (matches.length === 0) return;

  // Determine winners per match
  const phaseWinners: Record<string, Set<number>> = {}; // phase -> set of winner team_ids
  for (const m of matches) {
    if (m.home_score === m.away_score) {
      console.warn(`[scoring] Knockout match ${m.id} has equal scores — skipping (enter post-penalty result)`);
      continue;
    }
    const winner = m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
    const phase = m.phase;
    if (!phaseWinners[phase]) phaseWinners[phase] = new Set();
    phaseWinners[phase].add(winner);
  }

  // F-04: Bulk reset all bracket predictions for the pool
  await query(`
    UPDATE bracket_predictions SET points_earned = 0
    WHERE prediction_id IN (SELECT id FROM predictions WHERE pool_id = $1)
  `, [poolId]);

  // F-03: Bulk SELECT all bracket predictions for the pool
  const { rows: allBP } = await query(`
    SELECT bp.prediction_id, bp.phase, bp.team_id
    FROM bracket_predictions bp
    JOIN predictions p ON p.id = bp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allBP.length === 0) return;

  const bpByPred: Record<number, any[]> = {};
  for (const bp of allBP) {
    if (!bpByPred[bp.prediction_id]) bpByPred[bp.prediction_id] = [];
    bpByPred[bp.prediction_id].push(bp);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [predIdStr, bpRows] of Object.entries(bpByPred)) {
      const predId = Number(predIdStr);
      for (const bp of bpRows) {
        const winners = phaseWinners[bp.phase];
        if (winners && bp.team_id && winners.has(bp.team_id)) {
          const ruleKey = bp.phase === '3rd' ? 'third_place' : `knockout_${bp.phase}`;
          let pts = rules[ruleKey] ?? 0;
          if (bp.phase === 'final') {
            pts += rules['knockout_winner'] ?? 0;
          }
          await client.query(
            'UPDATE bracket_predictions SET points_earned = $1 WHERE prediction_id = $2 AND phase = $3 AND team_id = $4',
            [pts, predId, bp.phase, bp.team_id]
          );
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Calculate match prediction scores for all predictions in a pool.
 * Awards points_earned on match_predictions rows:
 *   - match_outcome points for correct 1/X/2
 *   - exact_score points on top for exact scoreline
 */
export async function calculateMatchScores(poolId: number): Promise<void> {
  const rules = await getScoringRules(poolId);
  const outcomePts = rules.match_outcome ?? 2;
  const exactPts = rules.exact_score ?? 5;

  // Get all finished matches (group or knockout) with scores
  const { rows: matches } = await query(`
    SELECT id, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
  `);

  if (matches.length === 0) return;

  // Build a lookup: matchId -> { homeScore, awayScore, outcome }
  const matchMap: Record<number, { homeScore: number; awayScore: number; outcome: string }> = {};
  for (const m of matches) {
    let outcome: string;
    if (m.home_score > m.away_score) outcome = '1';
    else if (m.home_score < m.away_score) outcome = '2';
    else outcome = 'X';
    matchMap[m.id] = { homeScore: m.home_score, awayScore: m.away_score, outcome };
  }

  // F-03: Bulk SELECT all match predictions for the pool
  const { rows: allMP } = await query(`
    SELECT mp.id, mp.prediction_id, mp.match_id, mp.home_score, mp.away_score
    FROM match_predictions mp
    JOIN predictions p ON p.id = mp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allMP.length === 0) return;

  const mpByPred: Record<number, any[]> = {};
  for (const mp of allMP) {
    if (!mpByPred[mp.prediction_id]) mpByPred[mp.prediction_id] = [];
    mpByPred[mp.prediction_id].push(mp);
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [, mpRows] of Object.entries(mpByPred)) {
      for (const mp of mpRows) {
        const m = matchMap[mp.match_id];
        if (!m) continue;

        let pts = 0;

        // Determine predicted outcome
        let predOutcome: string;
        if (mp.home_score > mp.away_score) predOutcome = '1';
        else if (mp.home_score < mp.away_score) predOutcome = '2';
        else predOutcome = 'X';

        // Correct outcome?
        if (predOutcome === m.outcome) {
          pts += outcomePts;
        }

        // Exact score?
        if (mp.home_score === m.homeScore && mp.away_score === m.awayScore) {
          pts += exactPts;
        }

        await client.query(
          'UPDATE match_predictions SET points_earned = $1 WHERE id = $2',
          [pts, mp.id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run all score calculations and update total_score in predictions table.
 */
export async function calculateAllScores(poolId: number): Promise<void> {
  await calculateGroupScores(poolId);
  await calculateBracketScores(poolId);
  await calculateMatchScores(poolId);

  // F-05: Sum up all points per prediction with LEFT JOIN instead of correlated subqueries
  await query(`
    UPDATE predictions SET
      total_score = (
        SELECT COALESCE(gp.g, 0) + COALESCE(bp.b, 0) + COALESCE(mp.m, 0)
        FROM (SELECT 1) x
        LEFT JOIN (SELECT SUM(points_earned) AS g FROM group_predictions WHERE prediction_id = predictions.id) gp ON 1=1
        LEFT JOIN (SELECT SUM(points_earned) AS b FROM bracket_predictions WHERE prediction_id = predictions.id) bp ON 1=1
        LEFT JOIN (SELECT SUM(points_earned) AS m FROM match_predictions WHERE prediction_id = predictions.id) mp ON 1=1
      ),
      updated_at = NOW()
    WHERE pool_id = $1
  `, [poolId]);
}
