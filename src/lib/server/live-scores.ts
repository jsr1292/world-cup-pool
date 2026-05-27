/**
 * Live Score Integration
 * 
 * Supports:
 * 1. API-Football (api-football.com) - free tier: 100 req/day
 * 2. Manual entry via admin panel (fallback)
 * 
 * Config: Set API_FOOTBALL_KEY env var or store in .env
 */

import { query } from './db.js';

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
  kickoff_time: Date | null;
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
        kickoff_time: fixture.fixture.date ? new Date(fixture.fixture.date) : null,
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
		// FIFA World Cup 2026 competition ID — verify this before the tournament starts
		// TODO: update '254648' once FIFA publishes 2026 WC official API endpoints
		const res = await fetch(
			`${FIFA_BASE}/matches/competitions/254648?status=completed`,
			{ headers: { 'Accept': 'application/json' } }
		);

		if (!res.ok) {
			const body = await res.text().catch(() => '(unreadable)');
			console.error(`[live-scores] FIFA API error: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
			return [];
		}

		const data = await res.json();
		if (!data.results || !Array.isArray(data.results)) {
			console.warn('[live-scores] FIFA API unexpected response shape:', JSON.stringify(data).slice(0, 200));
			return [];
		}

		const matches: LiveMatch[] = [];

		for (const m of data.results) {
      matches.push({
        fifa_id: String(m.idMatch),
        home_team: m.home?.teamName ?? '',
        away_team: m.away?.teamName ?? '',
        home_score: m.home?.score ?? 0,
        away_score: m.away?.score ?? 0,
        status: m.matchStatus === 'Completed' ? 'finished' : 'live',
        phase: mapFifaStageToPhase(m.idStage),
        kickoff_time: m.date ? new Date(m.date) : null,
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
      const res = await query('SELECT * FROM matches WHERE fifa_id = $1', [m.fifa_id]);
      dbMatch = res.rows[0] ?? null;
    }

    if (!dbMatch) {
      // Try matching by team names (fuzzy)
      // Escape LIKE wildcards % and _ in team names to prevent injection
      const escapeLike = (s: string) => s.replace(/[%_]/g, '\\$&');
      const res = await query(`
        SELECT m.* FROM matches m
        JOIN teams t1 ON t1.id = m.home_team_id
        JOIN teams t2 ON t2.id = m.away_team_id
        WHERE (t1.name LIKE $1 ESCAPE '\\' AND t2.name LIKE $2 ESCAPE '\\')
          AND m.status != 'finished'
        LIMIT 1
      `, [`%${escapeLike(m.home_team)}%`, `%${escapeLike(m.away_team)}%`]);
      dbMatch = res.rows[0] ?? null;
    }

    if (!dbMatch) { skipped++; continue; }

    try {
      const result = await query(`
        UPDATE matches 
        SET home_score = $1, away_score = $2, status = 'finished',
            kickoff_time = COALESCE(kickoff_time, $4)
        WHERE id = $3 AND status != 'finished'
      `, [m.home_score, m.away_score, dbMatch.id, m.kickoff_time]);

      if ((result.rowCount ?? 0) > 0) {
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

// FIFA World Cup 2026 numeric stage IDs — verify against live API before tournament starts
const FIFA_STAGE_MAP: Record<string, string> = {
	'285063': 'group',  // Group Stage
	'285064': 'r32',    // Round of 32
	'285065': 'r16',    // Round of 16
	'285066': 'qf',     // Quarter-finals
	'285067': 'sf',     // Semi-finals
	'285068': '3rd',    // Third Place
	'285069': 'final',  // Final
};

function mapFifaStageToPhase(stageId: string): string {
	const phase = FIFA_STAGE_MAP[stageId];
	if (!phase) {
		console.warn(`[live-scores] Unknown FIFA stage ID: ${stageId} — defaulting to 'unknown'`);
		return 'unknown';
	}
	return phase;
}
