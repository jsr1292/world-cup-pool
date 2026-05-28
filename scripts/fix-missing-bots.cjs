const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GROUPS = {
  A: [97, 98, 137, 141], B: [101, 102, 143, 144], C: [99, 104, 122, 134],
  D: [103, 109, 110, 120], E: [108, 112, 114, 133], F: [125, 127, 138, 139],
  G: [128, 129, 131, 135], H: [113, 116, 119, 142], I: [111, 118, 121, 140],
  J: [105, 106, 115, 136], K: [123, 124, 130, 132], L: [100, 107, 117, 126],
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function seedPrediction(predId, username) {
  const allIds = Object.values(GROUPS).flat();

  // Clear old data
  await pool.query('DELETE FROM group_predictions WHERE prediction_id = $1', [predId]);
  await pool.query('DELETE FROM bracket_predictions WHERE prediction_id = $1', [predId]);
  await pool.query('DELETE FROM tiebreaker WHERE prediction_id = $1', [predId]);

  // Groups
  for (const [group, teamIds] of Object.entries(GROUPS)) {
    const pos = shuffle(teamIds);
    await pool.query(
      'INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4) VALUES ($1,$2,$3,$4,$5,$6)',
      [predId, group, pos[0], pos[1], pos[2], pos[3]]
    );
  }

  // Bracket
  const r32 = shuffle(allIds).slice(0, 16);
  const r16 = shuffle(r32).slice(0, 8);
  const qf = shuffle(r16).slice(0, 4);
  const sf = shuffle(qf).slice(0, 2);
  const winner = sf[Math.floor(Math.random() * 2)];
  const runner = sf.find(t => t !== winner) || sf[0];

  for (const [phase, teams] of [['r32', r32], ['r16', r16], ['qf', qf], ['sf', sf]]) {
    for (let i = 0; i < teams.length; i++) {
      await pool.query(
        'INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1,$2,$3,$4)',
        [predId, phase, i, teams[i]]
      );
    }
  }
  await pool.query('INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1,$2,$3,$4)', [predId, 'final', 0, winner]);
  await pool.query('INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1,$2,$3,$4)', [predId, '3rd', 0, runner]);

  // Tiebreaker
  await pool.query('INSERT INTO tiebreaker (prediction_id, home_score, away_score) VALUES ($1,$2,$3)',
    [predId, Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)]);

  console.log('done ' + username + ' pred=' + predId);
}

async function run() {
  // Re-seed the 3 that were empty + fix Bot_Salah
  await seedPrediction(16, 'Bot_Salah');
  await seedPrediction(17, 'Bot_Neymar');
  await seedPrediction(18, 'Bot_Modric');
  await seedPrediction(19, 'Bot_DeBruyne');

  await pool.end();
  console.log('all done');
}

run().catch(e => { console.error(e); process.exit(1); });
