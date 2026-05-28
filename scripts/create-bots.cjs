const { Pool } = require('pg');
const { scryptSync, randomBytes } = require('crypto');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const BOTS = [
  { name: 'Bot_Bellingham', email: 'bot_bellingham@bot.wcp' },
  { name: 'Bot_Salah', email: 'bot_salah@bot.wcp' },
  { name: 'Bot_Neymar', email: 'bot_neymar@bot.wcp' },
  { name: 'Bot_Modric', email: 'bot_modric@bot.wcp' },
  { name: 'Bot_DeBruyne', email: 'bot_debruyne@bot.wcp' },
];

const PWD = 'botpass123';
const POOL_ID = 3;

async function run() {
  // Create missing bot users
  for (const bot of BOTS) {
    const salt = randomBytes(16).toString('hex');
    const key = scryptSync(PWD, salt, 64).toString('hex');
    const hash = `scrypt:${salt}:${key}`;

    try {
      const { rows } = await pool.query(
        'INSERT INTO users (username, password_hash, display_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
        [bot.name, hash, bot.name, bot.email]
      );
      console.log('✓ Created ' + bot.name + ' (id=' + rows[0].id + ')');
    } catch (e) {
      console.log('SKIP ' + bot.name + ': ' + e.message);
    }
  }

  // Add ALL bot users to pool 3 + create prediction entries
  const { rows: botUsers } = await pool.query(
    "SELECT id, username FROM users WHERE username LIKE 'Bot_%' OR username LIKE 'bot_%' OR username = 'test_frontend'"
  );

  for (const user of botUsers) {
    // Join pool
    try {
      await pool.query(
        'INSERT INTO pool_members (pool_id, user_id) VALUES (' + POOL_ID + ', ' + user.id + ') ON CONFLICT DO NOTHING'
      );
    } catch (e) {
      console.log('  ERR join ' + user.username + ': ' + e.message);
      continue;
    }

    // Create prediction entry
    const { rows: existing } = await pool.query(
      'SELECT id FROM predictions WHERE pool_id = ' + POOL_ID + ' AND user_id = ' + user.id
    );

    if (existing.length === 0) {
      const { rows: predRows } = await pool.query(
        'INSERT INTO predictions (pool_id, user_id, total_score) VALUES (' + POOL_ID + ', ' + user.id + ', 0) RETURNING id'
      );
      console.log('  ✓ ' + user.username + ': joined pool, pred_id=' + predRows[0].id);
    } else {
      console.log('  ✓ ' + user.username + ': already has pred_id=' + existing[0].id);
    }
  }

  await pool.end();
  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
