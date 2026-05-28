const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const POOL_ID = 3;

// Actual team IDs from DB, grouped
const GROUPS = {
  A: [97, 98, 137, 141],
  B: [101, 102, 143, 144],
  C: [99, 104, 122, 134],
  D: [103, 109, 110, 120],
  E: [108, 112, 114, 133],
  F: [125, 127, 138, 139],
  G: [128, 129, 131, 135],
  H: [113, 116, 119, 142],
  I: [111, 118, 121, 140],
  J: [105, 106, 115, 136],
  K: [123, 124, 130, 132],
  L: [100, 107, 117, 126],
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function run() {
  // Get all team IDs for bracket generation
  const allTeamIds = Object.values(GROUPS).flat();

  // Get all predictions for this pool
  const { rows: predictions } = await pool.query(
    'SELECT p.id, p.user_id, u.username FROM predictions p JOIN users u ON p.user_id = u.id WHERE p.pool_id = $1',
    [POOL_ID]
  );

  // Skip user_id 1 (JSR - already has predictions) and testadmin/testfront
  const skipUsers = [1, 10, 11];

  for (const pred of predictions) {
    if (skipUsers.includes(pred.user_id)) {
      console.log('  SKIP ' + pred.username + ' (real user)');
      continue;
    }

    // --- GROUP PREDICTIONS ---
    await pool.query('DELETE FROM group_predictions WHERE prediction_id = $1', [pred.id]);

    for (const [group, teamIds] of Object.entries(GROUPS)) {
      const positions = shuffle(teamIds);
      await pool.query(
        'INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4) VALUES ($1, $2, $3, $4, $5, $6)',
        [pred.id, group, positions[0], positions[1], positions[2], positions[3]]
      );
    }

    // --- BRACKET PREDICTIONS ---
    await pool.query('DELETE FROM bracket_predictions WHERE prediction_id = $1', [pred.id]);

    const r32 = shuffle(allTeamIds).slice(0, 16);
    const r16 = shuffle(r32).slice(0, 8);
    const qf = shuffle(r16).slice(0, 4);
    const sf = shuffle(qf).slice(0, 2);
    const winner = pick(sf);
    const runner = sf.find(t => t !== winner) || sf[0];

    const phases = [
      { name: 'r32', teams: r32 },
      { name: 'r16', teams: r16 },
      { name: 'qf', teams: qf },
      { name: 'sf', teams: sf },
    ];

    for (const phase of phases) {
      for (let i = 0; i < phase.teams.length; i++) {
        await pool.query(
          'INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1, $2, $3, $4)',
          [pred.id, phase.name, i, phase.teams[i]]
        );
      }
    }
    await pool.query(
      'INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1, $2, $3, $4)',
      [pred.id, 'final', 0, winner]
    );
    await pool.query(
      'INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id) VALUES ($1, $2, $3, $4)',
      [pred.id, '3rd', 0, runner]
    );

    // --- TIEBREAKER ---
    await pool.query('DELETE FROM tiebreaker WHERE prediction_id = $1', [pred.id]);
    const homeScore = Math.floor(Math.random() * 5);
    const awayScore = Math.floor(Math.random() * 5);
    await pool.query(
      'INSERT INTO tiebreaker (prediction_id, home_score, away_score) VALUES ($1, $2, $3)',
      [pred.id, homeScore, awayScore]
    );

    console.log('✓ ' + pred.username + ' (pred=' + pred.id + '): groups + bracket + tiebreaker');
  }

  await pool.end();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
