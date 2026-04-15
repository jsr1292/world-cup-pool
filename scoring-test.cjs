const Database = require('better-sqlite3');
const db = new Database('./data/pool.db');

// Import scoring logic inline since we can't use ESM imports
const DEFAULT_RULES = {
  group_position: 3,
  r32_winner: 5,
  r16_winner: 10,
  qf_winner: 20,
  sf_winner: 40,
  final_winner: 80,
  third_place: 25,
};

function getScoringRules(poolId) {
  const rows = db.prepare('SELECT rule, points FROM scoring_config WHERE pool_id = ?').all(poolId);
  if (rows.length === 0) return { ...DEFAULT_RULES };
  const config = {};
  for (const row of rows) config[row.rule] = row.points;
  return config;
}

function calculateGroupScores(poolId) {
  const rules = getScoringRules(poolId);
  const ptsPerPosition = rules.group_position ?? rules.group_position_exact ?? 3;
  
  console.log('Points per correct group position:', ptsPerPosition);

  const matches = db.prepare(`
    SELECT group_name, home_team_id, away_team_id, home_score, away_score
    FROM matches WHERE phase = 'group' AND status = 'finished' AND home_score IS NOT NULL
  `).all();

  console.log('Finished group matches:', matches.length);

  // Build actual standings
  const standings = {};
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
    if (m.home_score > m.away_score) h.points += 3;
    else if (m.home_score < m.away_score) a.points += 3;
    else { h.points += 1; a.points += 1; }
  }

  const actualPositions = {};
  for (const [group, teams] of Object.entries(standings)) {
    const sorted = Object.entries(teams)
      .map(([id, s]) => ({ id: Number(id), ...s, gd: s.gf - s.ga }))
      .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    actualPositions[group] = sorted.map(t => t.id);
  }

  // Show actual positions for group A as sample
  for (const [g, pos] of Object.entries(actualPositions).slice(0, 2)) {
    const names = pos.map(id => db.prepare('SELECT name FROM teams WHERE id = ?').get(id)?.name);
    console.log(`Group ${g} actual: ${names.join(', ')}`);
  }

  const predictions = db.prepare('SELECT id, user_id FROM predictions WHERE pool_id = ?').all(poolId);
  const updateGP = db.prepare('UPDATE group_predictions SET points_earned = ? WHERE prediction_id = ? AND group_name = ?');

  const calcAll = db.transaction(() => {
    for (const pred of predictions) {
      const gpRows = db.prepare(
        'SELECT group_name, position_1, position_2, position_3, position_4 FROM group_predictions WHERE prediction_id = ?'
      ).all(pred.id);

      for (const gp of gpRows) {
        const actual = actualPositions[gp.group_name];
        if (!actual) continue;
        let earned = 0;
        const predicted = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
        for (let i = 0; i < 4; i++) {
          if (predicted[i] && actual[i] === predicted[i]) earned += ptsPerPosition;
        }
        updateGP.run(earned, pred.id, gp.group_name);
      }
    }
  });
  calcAll();
}

// Run for pool 8
calculateGroupScores(8);

// Sum up and show results
db.prepare(`
  UPDATE predictions SET total_score = (
    COALESCE((SELECT SUM(points_earned) FROM group_predictions WHERE prediction_id = predictions.id), 0)
    + COALESCE((SELECT SUM(points_earned) FROM bracket_predictions WHERE prediction_id = predictions.id), 0)
  ),
  updated_at = datetime('now')
  WHERE pool_id = 8
`).run();

// Show leaderboard
const lb = db.prepare(`
  SELECT p.total_score, u.display_name, u.username
  FROM predictions p JOIN users u ON u.id = p.user_id
  WHERE p.pool_id = 8
  ORDER BY p.total_score DESC
  LIMIT 10
`).all();
console.log('\nPool 8 Leaderboard (top 10):');
lb.forEach((r, i) => console.log(`  ${i+1}. ${r.display_name} (${r.username}): ${r.total_score} pts`));

// Verify manually for user JSR (pred 6)
console.log('\nManual verification for JSR (pred 6):');
const gp6 = db.prepare('SELECT group_name, position_1, position_2, position_3, position_4, points_earned FROM group_predictions WHERE prediction_id = 6').all();
gp6.forEach(r => {
  console.log(`  Group ${r.group_name}: pos1=${r.position_1} pos2=${r.position_2} pos3=${r.position_3} pos4=${r.position_4} => ${r.points_earned} pts`);
});
