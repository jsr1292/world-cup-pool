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

const _provider = process.env.API_FOOTBALL_KEY
	? 'api-football'
	: process.env.ENABLE_FIFA_FALLBACK
		? 'fifa-stub'
		: 'none';
console.log(`[live-scores] provider: ${_provider}`);
if (_provider === 'none') {
	console.warn('[live-scores] No API_FOOTBALL_KEY and ENABLE_FIFA_FALLBACK not set — syncScores() will return 0 matches.');
}

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
      // §2.4 — Upstream "finished" matches can still arrive with null goals
      // (abandoned, walkover, ingestion lag). Skip rather than write 0-0.
      const homeScore = fixture.goals?.home;
      const awayScore = fixture.goals?.away;
      if (homeScore == null || awayScore == null) continue;
      matches.push({
        fifa_id: String(fixture.fixture.id),
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_score: homeScore,
        away_score: awayScore,
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
	if (!process.env.ENABLE_FIFA_FALLBACK) {
		console.warn('[live-scores] FIFA fallback disabled. Set ENABLE_FIFA_FALLBACK=1 to enable.');
		return [];
	}
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
      // §2.4 — Skip rows missing a score rather than coercing to 0.
      const homeScore = m.home?.score;
      const awayScore = m.away?.score;
      if (homeScore == null || awayScore == null) continue;
      matches.push({
        fifa_id: String(m.idMatch),
        home_team: m.home?.teamName ?? '',
        away_team: m.away?.teamName ?? '',
        home_score: homeScore,
        away_score: awayScore,
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
    // §2.5 — Refuse imports with an unmapped FIFA stage ID; otherwise the
    // unknown phase would silently slip past scoring queries that filter
    // by phase. Replace the stub stage IDs in FIFA_STAGE_MAP before kickoff.
    if (m.phase === 'unknown') { skipped++; continue; }

    // Find match by FIFA ID or team names
    let dbMatch: any = null;

    if (m.fifa_id) {
      const res = await query('SELECT * FROM matches WHERE fifa_id = $1', [m.fifa_id]);
      dbMatch = res.rows[0] ?? null;
    }

    if (!dbMatch) {
      // §2.4 — Resolve API team names through teams.name AND team_aliases,
      // using a normalized form (lower + strip diacritics + collapse spaces).
      const norm = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
         .toLowerCase().trim().replace(/\s+/g, ' ');
      const homeN = norm(m.home_team);
      const awayN = norm(m.away_team);

      const res = await query(
        `
        WITH resolver AS (
          SELECT id, lower(name) AS canon FROM teams
          UNION ALL
          SELECT team_id AS id, alias_normalized AS canon FROM team_aliases
        )
        SELECT m.*
        FROM matches m
        JOIN resolver rh ON rh.id = m.home_team_id AND rh.canon = $1
        JOIN resolver ra ON ra.id = m.away_team_id AND ra.canon = $2
        WHERE m.status != 'finished'
        LIMIT 1
        `,
        [homeN, awayN]
      );
      dbMatch = res.rows[0] ?? null;

      if (!dbMatch) {
        console.warn(
          `[live-scores] No DB match for "${m.home_team}" (norm "${homeN}") ` +
          `vs "${m.away_team}" (norm "${awayN}") — consider adding an alias.`
        );
      }
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

// §4.7 — FIFA World Cup 2026 numeric stage IDs. The IDs below are STUBS placed
// during scaffolding and were never confirmed against a live FIFA API
// response. Before the tournament kicks off:
//   1. Hit `${FIFA_BASE}/competitions/{competitionId}/stages` from a one-off
//      script (or use the live response from `${FIFA_BASE}/matches/...`).
//   2. Replace each value below with the real `idStage`.
//   3. Add a unit test that pins these IDs.
const FIFA_STAGE_MAP: Record<string, string> = {
	'285063': 'group',  // Group Stage    — STUB
	'285064': 'r32',    // Round of 32    — STUB
	'285065': 'r16',    // Round of 16    — STUB
	'285066': 'qf',     // Quarter-finals — STUB
	'285067': 'sf',     // Semi-finals    — STUB
	'285068': '3rd',    // Third Place    — STUB
	'285069': 'final',  // Final          — STUB
};

function mapFifaStageToPhase(stageId: string): string {
	const phase = FIFA_STAGE_MAP[stageId];
	if (!phase) {
		console.warn(`[live-scores] Unknown FIFA stage ID: ${stageId} — defaulting to 'unknown'`);
		return 'unknown';
	}
	return phase;
}
