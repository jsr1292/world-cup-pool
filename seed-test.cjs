const Database = require('better-sqlite3');
const db = new Database('./data/pool.db');

const teams = db.prepare('SELECT id, name, group_name FROM teams ORDER BY group_name, id').all();
const groupMap = {};
for (const t of teams) {
  if (!groupMap[t.group_name]) groupMap[t.group_name] = [];
  groupMap[t.group_name].push(t);
}

db.prepare("DELETE FROM matches WHERE phase = 'group'").run();

const insertMatch = db.prepare(`
  INSERT INTO matches (phase, matchday, group_name, home_team_id, away_team_id, home_score, away_score, status, sort_order)
  VALUES ('group', 1, ?, ?, ?, ?, ?, 'finished', ?)
`);

let sortOrder = 0;
const seedAll = db.transaction(() => {
  for (const [group, gTeams] of Object.entries(groupMap)) {
    for (let i = 0; i < gTeams.length; i++) {
      for (let j = i + 1; j < gTeams.length; j++) {
        insertMatch.run(group, gTeams[i].id, gTeams[j].id, 2, 1, sortOrder++);
      }
    }
  }
});

seedAll();
console.log('Seeded', db.prepare("SELECT COUNT(*) as c FROM matches WHERE phase = 'group'").get().c, 'group matches');

// Check pool 8 predictions
const predictions = db.prepare('SELECT id, user_id, total_score FROM predictions WHERE pool_id = 8').all();
console.log('Pool 8 predictions:', predictions.length);
for (const p of predictions) {
  const gp = db.prepare('SELECT COUNT(*) as c FROM group_predictions WHERE prediction_id = ?').get(p.id).c;
  console.log(`  Pred ${p.id} (user ${p.user_id}): ${gp} group preds, score=${p.total_score}`);
}
