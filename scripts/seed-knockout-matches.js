// Seed knockout stage matches into the database
// Run: node scripts/seed-knockout-matches.js

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../data/pool.db');
const db = new Database(dbPath);

// Check if knockout matches already exist
const existing = db.prepare("SELECT COUNT(*) as cnt FROM matches WHERE phase != 'group'").get();
if (existing.cnt > 0) {
  console.log(`Knockout matches already exist (${existing.cnt}). Skipping.`);
  process.exit(0);
}

const insert = db.prepare(`
  INSERT INTO matches (phase, matchday, group_name, home_team_id, away_team_id, status, sort_order)
  VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
`);

// For knockout rounds, teams are determined by group results
// We leave home/away as NULL — they get filled when group stage completes
// FIFA determines the actual matchup structure

// R32: 16 matches (matchday 1-4)
// In 2026 format: 1st/2nd from each group + 8 best 3rd place teams
// For now, seed with null teams — will be populated after group stage
const rounds = [
  { phase: 'r32', count: 16, matchday: 1 },
  { phase: 'r16', count: 8, matchday: 2 },
  { phase: 'qf', count: 4, matchday: 3 },
  { phase: 'sf', count: 2, matchday: 4 },
  { phase: 'final', count: 1, matchday: 5 },
  { phase: '3rd', count: 1, matchday: 5 },
];

const seedAll = db.transaction(() => {
  let sort = 0;
  for (const round of rounds) {
    for (let i = 0; i < round.count; i++) {
      insert.run(round.phase, round.matchday, null, null, null, sort++);
    }
  }
});

seedAll();
const total = db.prepare("SELECT COUNT(*) as cnt FROM matches WHERE phase != 'group'").get();
console.log(`✓ Seeded ${total.cnt} knockout matches (R32:16, R16:8, QF:4, SF:2, Final:1, 3rd:1)`);
db.close();
