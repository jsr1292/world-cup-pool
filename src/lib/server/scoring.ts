import { db } from './db.js';

const DEFAULT_RULES: Record<string, number> = {
  group_position: 3,
  knockout_r32: 5,
  knockout_r16: 10,
  knockout_qf: 20,
  knockout_sf: 40,
  knockout_final: 80,
  knockout_winner: 100,
  third_place: 25,
};

export function getScoringRules(poolId: number): Record<string, number> {
  const rows = db.prepare('SELECT rule, points FROM scoring_config WHERE pool_id = ?').all(poolId) as any[];
  if (rows.length === 0) return { ...DEFAULT_RULES };
  const config: Record<string, number> = {};
  for (const row of rows) config[row.rule] = row.points;
  return config;
}

/**
 * Calculate group stage scores for all predictions in a pool.
 * Compares each user's predicted group positions against actual match results.
 */
export function calculateGroupScores(poolId: number): void {
  const rules = getScoringRules(poolId);
  const ptsPerPosition = rules.group_position ?? 3;

  // Get all finished group matches
  const matches = db.prepare(`
    SELECT group_name, home_team_id, away_team_id, home_score, away_score
    FROM matches WHERE phase = 'group' AND status = 'finished' AND home_score IS NOT NULL
  `).all() as any[];

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

  // Get all predictions for this pool
  const predictions = db.prepare(
    'SELECT id FROM predictions WHERE pool_id = ?'
  ).all(poolId) as any[];

  const updateGP = db.prepare(
    'UPDATE group_predictions SET points_earned = ? WHERE prediction_id = ? AND group_name = ?'
  );

  const calcAll = db.transaction(() => {
    for (const pred of predictions) {
      const gpRows = db.prepare(
        'SELECT group_name, position_1, position_2, position_3, position_4 FROM group_predictions WHERE prediction_id = ?'
      ).all(pred.id) as any[];

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
        updateGP.run(earned, pred.id, gp.group_name);
      }
    }
  });

  calcAll();
}

/**
 * Calculate knockout bracket scores for all predictions in a pool.
 * Compares predicted bracket picks against actual match winners.
 */
export function calculateBracketScores(poolId: number): void {
  const rules = getScoringRules(poolId);

  // Get all finished knockout matches
  const matches = db.prepare(`
    SELECT id, phase, home_team_id, away_team_id, home_score, away_score
    FROM matches
    WHERE phase IN ('r32','r16','qf','sf','final','3rd')
      AND status = 'finished' AND home_score IS NOT NULL AND away_score IS NOT NULL
  `).all() as any[];

  if (matches.length === 0) return;

  // Determine winners per match
  const phaseWinners: Record<string, Set<number>> = {}; // phase -> set of winner team_ids
  for (const m of matches) {
    const winner = m.home_score > m.away_score ? m.home_team_id : m.away_score > m.home_score ? m.away_team_id : null;
    if (winner) {
      const phase = m.phase;
      if (!phaseWinners[phase]) phaseWinners[phase] = new Set();
      phaseWinners[phase].add(winner);
    }
  }

  const predictions = db.prepare(
    'SELECT id FROM predictions WHERE pool_id = ?'
  ).all(poolId) as any[];

  const updateBP = db.prepare(
    'UPDATE bracket_predictions SET points_earned = ? WHERE prediction_id = ? AND phase = ? AND team_id = ?'
  );
  const resetBP = db.prepare(
    'UPDATE bracket_predictions SET points_earned = 0 WHERE prediction_id = ?'
  );

  const calcAll = db.transaction(() => {
    for (const pred of predictions) {
      // Reset all bracket points first
      resetBP.run(pred.id);

      const bpRows = db.prepare(
        'SELECT phase, team_id FROM bracket_predictions WHERE prediction_id = ?'
      ).all(pred.id) as any[];

      for (const bp of bpRows) {
        const winners = phaseWinners[bp.phase];
        if (winners && bp.team_id && winners.has(bp.team_id)) {
          const ruleKey = bp.phase === '3rd' ? 'third_place' : `knockout_${bp.phase}`;
          const pts = rules[ruleKey] ?? 0;
          updateBP.run(pts, pred.id, bp.phase, bp.team_id);
        }
      }
    }
  });

  calcAll();
}

/**
 * Run all score calculations and update total_score in predictions table.
 */
export function calculateAllScores(poolId: number): void {
  calculateGroupScores(poolId);
  calculateBracketScores(poolId);

  // Sum up all points per prediction
  db.prepare(`
    UPDATE predictions SET total_score = (
      COALESCE((SELECT SUM(points_earned) FROM group_predictions WHERE prediction_id = predictions.id), 0)
      + COALESCE((SELECT SUM(points_earned) FROM bracket_predictions WHERE prediction_id = predictions.id), 0)
    ),
    updated_at = datetime('now')
    WHERE pool_id = ?
  `).run(poolId);
}
