/**
 * Live Score Integration
 * 
 * Supports:
 * 1. API-Football (api-football.com) - free tier: 100 req/day
 * 2. Manual entry via admin panel (fallback)
 * 
 * Config: Set API_FOOTBALL_KEY env var or store in .env
 */

import { db } from './db.js';

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const FIFA_BASE = 'https://api.fifa.com/api/v3';

interface LiveMatch {
  fifa_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: 'scheduled' | 'live' | 'finished';
  phase: string;
}

/**
 * Fetch finished matches from API-Football
 * Requires API_FOOTBALL_KEY env var
 */
export async function fetchFromApiFootball(leagueId = 1, season = 2026): Promise<LiveMatch[]> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    console.warn('[live-scores] No API_FOOTBALL_KEY set, skipping API fetch');
    return [];
  }

  try {
    const res = await fetch(
      `${API_FOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}&status=FT`,
      { headers: { 'x-apisports-key': apiKey } }
    );
    
    if (!res.ok) {
      console.error(`[live-scores] API-Football error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const matches: LiveMatch[] = [];

    for (const fixture of (data.response || [])) {
      matches.push({
        fifa_id: String(fixture.fixture.id),
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_score: fixture.goals.home ?? 0,
        away_score: fixture.goals.away ?? 0,
        status: 'finished',
        phase: mapRoundToPhase(fixture.fixture.round),
      });
    }

    return matches;
  } catch (e) {
    console.error('[live-scores] fetch error:', e);
    return [];
  }
}

/**
 * Fetch from FIFA's public API (no key required, but may be rate-limited)
 */
export async function fetchFromFifaApi(): Promise<LiveMatch[]> {
  try {
    // FIFA World Cup 2026 competition ID
    const res = await fetch(
      `${FIFA_BASE}/matches/competitions/254648/status=completed`,
      { headers: { 'Accept': 'application/json' } }
    );

    if (!res.ok) {
      console.error(`[live-scores] FIFA API error: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const matches: LiveMatch[] = [];

    for (const m of (data.results || [])) {
      matches.push({
        fifa_id: String(m.idMatch),
        home_team: m.home?.teamName ?? '',
        away_team: m.away?.teamName ?? '',
        home_score: m.home?.score ?? 0,
        away_score: m.away?.score ?? 0,
        status: m.matchStatus === 'Completed' ? 'finished' : 'live',
        phase: mapFifaStageToPhase(m.idStage),
      });
    }

    return matches;
  } catch (e) {
    console.error('[live-scores] FIFA API fetch error:', e);
    return [];
  }
}

/**
 * Sync live scores into our DB. Only updates finished matches.
 */
export async function syncScores(): Promise<{ updated: number; skipped: number; errors: number }> {
  let matches: LiveMatch[] = [];
  
  // Try API-Football first, then FIFA
  matches = await fetchFromApiFootball();
  if (matches.length === 0) {
    matches = await fetchFromFifaApi();
  }

  if (matches.length === 0) {
    return { updated: 0, skipped: 0, errors: 0 };
  }

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const m of matches) {
    if (m.status !== 'finished') { skipped++; continue; }

    // Find match by FIFA ID or team names
    let dbMatch: any = null;

    if (m.fifa_id) {
      dbMatch = db.prepare('SELECT * FROM matches WHERE fifa_id = ?').get(m.fifa_id) as any;
    }

    if (!dbMatch) {
      // Try matching by team names (fuzzy)
      dbMatch = db.prepare(`
        SELECT m.* FROM matches m
        JOIN teams t1 ON t1.id = m.home_team_id
        JOIN teams t2 ON t2.id = m.away_team_id
        WHERE (t1.name LIKE ? OR t2.name LIKE ?) AND m.status != 'finished'
        LIMIT 1
      `).get(`%${m.home_team}%`, `%${m.away_team}%`) as any;
    }

    if (!dbMatch) { skipped++; continue; }

    try {
      db.prepare(`
        UPDATE matches 
        SET home_score = ?, away_score = ?, status = 'finished'
        WHERE id = ? AND status != 'finished'
      `).run(m.home_score, m.away_score, dbMatch.id);

      if (db.prepare('SELECT changes() as c').get().c > 0) {
        updated++;
      } else {
        skipped++;
      }
    } catch (e) {
      console.error(`[live-scores] Error updating match ${dbMatch.id}:`, e);
      errors++;
    }
  }

  return { updated, skipped, errors };
}

function mapRoundToPhase(round: string): string {
  if (!round) return 'group';
  const r = round.toLowerCase();
  if (r.includes('group')) return 'group';
  if (r.includes('round of 32') || r.includes('32')) return 'r32';
  if (r.includes('round of 16') || r.includes('16')) return 'r16';
  if (r.includes('quarter')) return 'qf';
  if (r.includes('semi')) return 'sf';
  if (r.includes('3rd') || r.includes('third')) return '3rd';
  if (r.includes('final')) return 'final';
  return 'group';
}

function mapFifaStageToPhase(stageId: string): string {
  // FIFA stage IDs mapping (approximate)
  const map: Record<string, string> = {
    'group': 'group',
    'r32': 'r32',
    'r16': 'r16',
    'qf': 'qf',
    'sf': 'sf',
    '3rd': '3rd',
    'final': 'final',
  };
  return map[stageId] ?? 'group';
}
