const Database = require("better-sqlite3");
const db = new Database("data/pool.db");

// Clear existing group matches
db.prepare("DELETE FROM matches WHERE phase = 'group'").run();

const m = [
  // Group A: Mexico(1) strong, Scotland(3) 2nd
  {gn:"A",h:1,a:2,hs:2,as:0,s:1},{gn:"A",h:3,a:4,hs:1,as:1,s:2},
  {gn:"A",h:1,a:3,hs:3,as:0,s:3},{gn:"A",h:2,a:4,hs:0,as:1,s:4},
  {gn:"A",h:1,a:4,hs:1,as:0,s:5},{gn:"A",h:2,a:3,hs:0,as:2,s:6},
  // Group B
  {gn:"B",h:5,a:6,hs:1,as:1,s:7},{gn:"B",h:7,a:8,hs:2,as:0,s:8},
  {gn:"B",h:5,a:7,hs:0,as:1,s:9},{gn:"B",h:6,a:8,hs:3,as:0,s:10},
  // Group C
  {gn:"C",h:9,a:10,hs:2,as:1,s:11},{gn:"C",h:11,a:12,hs:0,as:3,s:12},
];

const ins = db.prepare("INSERT INTO matches (phase,matchday,group_name,home_team_id,away_team_id,home_score,away_score,status,sort_order) VALUES ('group',1,@gn,@h,@a,@hs,@as,'finished',@s)");
for (const x of m) ins.run(x);
console.log("Seeded " + m.length + " matches");

// Now calculate scores manually
const rules = {};
const rows = db.prepare("SELECT rule, points FROM scoring_config WHERE pool_id = 8").all();
for (const r of rows) rules[r.rule] = r.points;
const ptsPerPos = rules.group_position || 3;

const matches = db.prepare("SELECT group_name, home_team_id, away_team_id, home_score, away_score FROM matches WHERE phase = 'group' AND status = 'finished'").all();

const standings = {};
for (const mt of matches) {
  if (!mt.group_name) continue;
  if (!standings[mt.group_name]) standings[mt.group_name] = {};
  const gs = standings[mt.group_name];
  if (!gs[mt.home_team_id]) gs[mt.home_team_id] = {points:0,gf:0,ga:0};
  if (!gs[mt.away_team_id]) gs[mt.away_team_id] = {points:0,gf:0,ga:0};
  const h = gs[mt.home_team_id], a = gs[mt.away_team_id];
  h.gf += mt.home_score; h.ga += mt.away_score;
  a.gf += mt.away_score; a.ga += mt.home_score;
  if (mt.home_score > mt.away_score) h.points += 3;
  else if (mt.home_score < mt.away_score) a.points += 3;
  else { h.points += 1; a.points += 1; }
}

const actualPos = {};
for (const [g, ts] of Object.entries(standings)) {
  const sorted = Object.entries(ts).map(([id,s]) => ({id:Number(id),...s,gd:s.gf-s.ga})).sort((a,b) => b.points-a.points || b.gd-a.gd || b.gf-a.gf);
  actualPos[g] = sorted.map(t=>t.id);
}
console.log("Actual positions:", JSON.stringify(actualPos));

const preds = db.prepare("SELECT id FROM predictions WHERE pool_id = 8").all();
const updateGP = db.prepare("UPDATE group_predictions SET points_earned = ? WHERE prediction_id = ? AND group_name = ?");
const calc = db.transaction(() => {
  for (const pred of preds) {
    const gpRows = db.prepare("SELECT group_name, position_1, position_2, position_3, position_4 FROM group_predictions WHERE prediction_id = ?").all(pred.id);
    for (const gp of gpRows) {
      const actual = actualPos[gp.group_name];
      if (!actual) continue;
      let earned = 0;
      const predicted = [gp.position_1, gp.position_2, gp.position_3, gp.position_4];
      for (let i = 0; i < 4; i++) {
        if (predicted[i] && actual[i] === predicted[i]) earned += ptsPerPos;
      }
      updateGP.run(earned, pred.id, gp.group_name);
    }
  }
});
calc();

db.prepare("UPDATE predictions SET total_score = COALESCE((SELECT SUM(points_earned) FROM group_predictions WHERE prediction_id = predictions.id), 0) + COALESCE((SELECT SUM(points_earned) FROM bracket_predictions WHERE prediction_id = predictions.id), 0), updated_at = datetime('now') WHERE pool_id = 8").run();

const top = db.prepare("SELECT p.id, u.display_name, p.total_score FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.pool_id = 8 ORDER BY p.total_score DESC LIMIT 10").all();
console.log("Top 10:", JSON.stringify(top));
