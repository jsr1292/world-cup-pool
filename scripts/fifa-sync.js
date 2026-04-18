// FIFA Match Sync Service
// Pulls match results from FIFA API and updates local DB
// Run via cron during tournament: node scripts/fifa-sync.js
//
// Status: READY - will be activated closer to tournament (June 2026)
// FIFA typically publishes endpoints a few weeks before kickoff

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../data/pool.db');

// FIFA API configuration
// TODO: Update these when FIFA publishes 2026 WC endpoints
const FIFA_CONFIG = {
  baseUrl: 'https://api.fifa.com/api/v3',
  competitionId: '352',       // World Cup
  seasonId: '255711',         // 2026 season (update when confirmed)
  syncInterval: 300000,       // 5 minutes during live matches
};

async function fetchMatches() {
  try {
    const url = `${FIFA_CONFIG.baseUrl}/competition/${FIFA_CONFIG.competitionId}/season/${FIFA_CONFIG.seasonId}/match`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FIFA API ${res.status}`);
    const data = await res.json();
    return data?.results || data || [];
  } catch (e) {
    console.error('FIFA API error:', e.message);
    return null;
  }
}

function updateMatchResults(matches) {
  const db = new Database(dbPath);
  let updated = 0;

  const getMatch = db.prepare(`
    SELECT id FROM matches WHERE fifa_id = ?
  `);

  const updateMatch = db.prepare(`
    UPDATE matches SET home_score = ?, away_score = ?, status = ? WHERE fifa_id = ?
  `);

  const updateTeams = db.prepare(`
    UPDATE matches SET home_team_id = ?, away_team_id = ? WHERE id = ?
  `);

  // Team name to ID lookup
  const teamLookup = {};
  const teams = db.prepare('SELECT id, name, flag_code FROM teams').all();
  for (const t of teams) {
    teamLookup[t.name.toLowerCase()] = t.id;
    if (t.flag_code) teamLookup[t.flag_code.toLowerCase()] = t.id;
  }

  for (const match of matches) {
    if (!match.idMatch) continue;

    const existing = getMatch.get(match.idMatch);
    const homeScore = match.home?.score;
    const awayScore = match.away?.score;
    const status = match.matchStatus === 'Played' ? 'finished'
      : match.matchStatus === 'Live' ? 'live'
      : 'scheduled';

    if (existing) {
      // Update existing match
      if (homeScore != null && awayScore != null) {
        updateMatch.run(homeScore, awayScore, status, match.idMatch);
        updated++;
      }
    } else {
      // New match — insert with team IDs
      const homeTeam = match.home?.idTeam ? findTeamId(match.home, teamLookup) : null;
      const awayTeam = match.away?.idTeam ? findTeamId(match.away, teamLookup) : null;
      const phase = mapPhase(match.idStage, match.idGroup);

      db.prepare(`
        INSERT INTO matches (fifa_id, phase, group_name, home_team_id, away_team_id, home_score, away_score, status, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).run(
        match.idMatch,
        phase,
        match.idGroup || null,
        homeTeam,
        awayTeam,
        homeScore ?? null,
        awayScore ?? null,
        status,
      );
      updated++;
    }
  }

  db.close();
  return updated;
}

function findTeamId(teamData, lookup) {
  // Try various name formats
  const candidates = [
    teamData.name?.toLowerCase(),
    teamData.shortName?.toLowerCase(),
    teamData.countryCode?.toLowerCase(),
  ];
  for (const c of candidates) {
    if (c && lookup[c]) return lookup[c];
  }
  return null;
}

function mapPhase(stageId, groupId) {
  if (groupId) return 'group';
  const phaseMap = {
    'r32': 'r32', 'round_of_32': 'r32',
    'r16': 'r16', 'round_of_16': 'r16',
    'qf': 'qf', 'quarter_final': 'qf', 'quarterfinal': 'qf',
    'sf': 'sf', 'semi_final': 'sf', 'semifinal': 'sf',
    'final': 'final',
    'third_place': '3rd', '3rd_place': '3rd',
  };
  for (const [key, val] of Object.entries(phaseMap)) {
    if (stageId?.toLowerCase().includes(key)) return val;
  }
  return 'group';
}

// Main sync function
async function sync() {
  console.log(`[FIFA Sync] ${new Date().toISOString()} - Starting sync...`);
  const matches = await fetchMatches();

  if (!matches) {
    console.log('[FIFA Sync] Failed to fetch. Will retry next cycle.');
    return;
  }

  const updated = updateMatchResults(matches);
  console.log(`[FIFA Sync] Updated ${updated} matches`);

  // Trigger score recalculation for all active pools
  if (updated > 0) {
    const db = new Database(dbPath);
    const { calculateAllScores } = await import('$lib/server/scoring.ts');
    const pools = db.prepare('SELECT id FROM pools WHERE is_active = 1').all();
    for (const p of pools) {
      try {
        calculateAllScores(p.id);
      } catch (e) {
        console.error(`Score calc error pool ${p.id}:`, e);
      }
    }
    db.close();
    console.log(`[FIFA Sync] Recalculated scores for ${pools.length} pools`);
  }
}

// Run once or in loop
const args = process.argv.slice(2);
if (args.includes('--daemon')) {
  console.log('[FIFA Sync] Starting daemon mode...');
  sync();
  setInterval(sync, FIFA_CONFIG.syncInterval);
} else {
  sync();
}
