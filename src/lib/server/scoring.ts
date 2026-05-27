import { query, getClient } from './db.js';
import type { PoolClient } from 'pg';

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
  third_place: 6,
};

export async function getScoringRules(poolId: number): Promise<Record<string, number>> {
	const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
	// Always start with defaults; DB rows override them — never leaves a key undefined
	const config: Record<string, number> = { ...DEFAULT_RULES };
	for (const row of rows) config[row.rule] = row.points;
	return config;
}

/**
 * Calculate group stage scores for all predictions in a pool.
 * Compares each user's predicted group positions against actual match results.
 * Uses bulk unnest() UPDATE instead of per-row loops.
 */
export async function calculateGroupScores(
  poolId: number,
  rules: Record<string, number>,
  client: PoolClient
): Promise<void> {
	const ptsPerPosition = rules.group_position;

  // Get all finished group matches
  const { rows: matches } = await client.query(`
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

  // Bulk fetch all group predictions for this pool
  const { rows: allGP } = await client.query(`
    SELECT gp.prediction_id, gp.group_name, gp.position_1, gp.position_2, gp.position_3, gp.position_4
    FROM group_predictions gp
    JOIN predictions p ON p.id = gp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allGP.length === 0) return;

  // Collect (prediction_id, group_name, points) for bulk unnest UPDATE
  const predIds: number[] = [];
  const groupNames: string[] = [];
  const ptsArray: number[] = [];

  for (const gp of allGP) {
    const actual = actualPositions[gp.group_name];
    if (!actual) continue;

    let earned = 0;
    const predicted = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
    for (let i = 0; i < 4; i++) {
      if (predicted[i] && actual[i] === predicted[i]) {
        earned += ptsPerPosition;
      }
    }
    predIds.push(gp.prediction_id);
    groupNames.push(gp.group_name);
    ptsArray.push(earned);
  }

  if (predIds.length === 0) return;

  // M3: Single bulk UPDATE via unnest instead of N individual UPDATEs
  await client.query(`
    UPDATE group_predictions gp SET points_earned = v.pts
    FROM unnest($1::int[], $2::text[], $3::int[]) AS v(pred_id, grp_name, pts)
    WHERE gp.prediction_id = v.pred_id AND gp.group_name = v.grp_name
  `, [predIds, groupNames, ptsArray]);
}

/**
 * Calculate knockout bracket scores for all predictions in a pool.
 * Compares predicted bracket picks against actual match winners.
 * Uses bulk unnest() UPDATE — sets ALL rows (0 for wrong/empty, earned for correct).
 */
export async function calculateBracketScores(
  poolId: number,
  rules: Record<string, number>,
  client: PoolClient
): Promise<void> {
  // Get all finished knockout matches
	const { rows: matches } = await client.query(`
		SELECT id, phase, home_team_id, away_team_id, home_score, away_score, penalty_winner_id
		FROM matches
		WHERE phase IN ('r32','r16','qf','sf','final','3rd')
		  AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
	`);

  if (matches.length === 0) return;

  // Determine winners per match
  const phaseWinners: Record<string, Set<number>> = {}; // phase -> set of winner team_ids
	for (const m of matches) {
		const winner =
			m.home_score > m.away_score ? m.home_team_id :
			m.home_score < m.away_score ? m.away_team_id :
			m.penalty_winner_id         ? m.penalty_winner_id :
			null; // still undecided — no penalty winner recorded yet

		if (winner === null) {
			// Match result not yet determinable — skip without warning
			continue;
		}
		const phase = m.phase;
		if (!phaseWinners[phase]) phaseWinners[phase] = new Set();
		phaseWinners[phase].add(winner);
	}

  // Bulk SELECT all bracket predictions for the pool
  const { rows: allBP } = await client.query(`
    SELECT bp.prediction_id, bp.phase, bp.team_id
    FROM bracket_predictions bp
    JOIN predictions p ON p.id = bp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allBP.length === 0) return;

  // Collect ALL bracket predictions with computed points (0 for wrong, earned for correct)
  const predIds: number[] = [];
  const phases: string[] = [];
  const teamIds: (number | null)[] = [];
  const ptsArray: number[] = [];

  for (const bp of allBP) {
    const winners = phaseWinners[bp.phase];
    let pts = 0;
    if (winners && bp.team_id && winners.has(bp.team_id)) {
      const ruleKey = bp.phase === '3rd' ? 'third_place' : `knockout_${bp.phase}`;
      pts = rules[ruleKey] ?? 0;
      if (bp.phase === 'final') {
        pts += rules['knockout_winner'] ?? 0;
      }
    }
    predIds.push(bp.prediction_id);
    phases.push(bp.phase);
    teamIds.push(bp.team_id);
    ptsArray.push(pts);
  }

  // M3: Single bulk UPDATE via unnest — replaces the old reset-all + per-row-update pattern
  await client.query(`
    UPDATE bracket_predictions bp SET points_earned = v.pts
    FROM unnest($1::int[], $2::text[], $3::int[], $4::int[]) AS v(pred_id, phase, team_id, pts)
    WHERE bp.prediction_id = v.pred_id AND bp.phase = v.phase
      AND bp.team_id IS NOT DISTINCT FROM v.team_id
  `, [predIds, phases, teamIds, ptsArray]);
}

/**
 * Calculate match prediction scores for all predictions in a pool.
 * Awards points_earned on match_predictions rows:
 *   - match_outcome points for correct 1/X/2
 *   - exact_score points on top for exact scoreline
 * Uses bulk unnest() UPDATE instead of per-row loops.
 */
export async function calculateMatchScores(
  poolId: number,
  rules: Record<string, number>,
  client: PoolClient
): Promise<void> {
	const outcomePts = rules.match_outcome;
	const exactPts = rules.exact_score;

  // Get all finished matches (group or knockout) with scores
  const { rows: matches } = await client.query(`
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

  // Bulk SELECT all match predictions for the pool
  const { rows: allMP } = await client.query(`
    SELECT mp.id, mp.prediction_id, mp.match_id, mp.home_score, mp.away_score
    FROM match_predictions mp
    JOIN predictions p ON p.id = mp.prediction_id
    WHERE p.pool_id = $1
  `, [poolId]);

  if (allMP.length === 0) return;

  // Collect (id, points) for bulk unnest UPDATE
  const ids: number[] = [];
  const ptsArray: number[] = [];

	for (const mp of allMP) {
		const m = matchMap[mp.match_id];
		if (!m) continue;

		// Skip predictions with no score entered — null comparisons silently fall to 'X' (draw)
		if (mp.home_score === null || mp.away_score === null) continue;

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

    ids.push(mp.id);
    ptsArray.push(pts);
  }

  if (ids.length === 0) return;

  // M3: Single bulk UPDATE via unnest instead of N individual UPDATEs
  await client.query(`
    UPDATE match_predictions mp SET points_earned = v.pts
    FROM unnest($1::int[], $2::int[]) AS v(id, pts)
    WHERE mp.id = v.id
  `, [ids, ptsArray]);
}

/**
 * Run all score calculations and update total_score in predictions table.
 *
 * M4: Fetches scoring rules ONCE and passes them to all sub-functions.
 * M5: Runs ALL phases + total_score update in a single transaction.
 */
export async function calculateAllScores(poolId: number): Promise<void> {
  // M4: Fetch rules once — sub-functions receive them as a parameter
  const rules = await getScoringRules(poolId);

  // M5: Single transaction for all phases + total_score update
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // WCP-12/B6-3: Acquire a per-pool advisory lock (xact-scoped, released on COMMIT/ROLLBACK).
    // pg_try_advisory_xact_lock returns false immediately if already held — no blocking.
    // This serializes concurrent scoring runs for the same pool without queue contention.
    const { rows: lockRows } = await client.query(
      'SELECT pg_try_advisory_xact_lock($1) AS acquired',
      [poolId]
    );
    if (!lockRows[0].acquired) {
      // Another scoring run is already in progress for this pool — skip gracefully.
      await client.query('ROLLBACK');
      return;
    }

    await calculateGroupScores(poolId, rules, client);
    await calculateBracketScores(poolId, rules, client);
    await calculateMatchScores(poolId, rules, client);

    // Update total_score for all predictions in the pool (inside the same transaction)
    await client.query(`
      UPDATE predictions p SET
        total_score = sub.total,
        updated_at = NOW()
      FROM (
        SELECT pred.id,
          COALESCE((SELECT SUM(gp.points_earned) FROM group_predictions gp WHERE gp.prediction_id = pred.id), 0) +
          COALESCE((SELECT SUM(bp.points_earned) FROM bracket_predictions bp WHERE bp.prediction_id = pred.id), 0) +
          COALESCE((SELECT SUM(mp.points_earned) FROM match_predictions mp WHERE mp.prediction_id = pred.id), 0) as total
        FROM predictions pred
        WHERE pred.pool_id = $1
      ) sub
      WHERE p.id = sub.id
    `, [poolId]);

    await client.query('COMMIT');

    // Track successful scoring
    await query(
      'UPDATE pools SET last_scored_at = NOW(), last_score_error = NULL WHERE id = $1',
      [poolId]
    );
  } catch (err) {
    await client.query('ROLLBACK');

    // Track scoring failure
    await query(
      'UPDATE pools SET last_score_error = $2 WHERE id = $1',
      [poolId, (err as Error).message ?? String(err)]
    ).catch(() => {}); // don't let tracking failure mask the original error

    throw err;
  } finally {
    client.release();
  }
}
