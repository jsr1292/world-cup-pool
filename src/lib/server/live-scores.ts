/**
 * Live Score Integration
 *
 * Pulls finished match results from an external provider and writes them into
 * our `matches` table, including:
 *   - group results (preserving our home/away orientation so users' match-score
 *     predictions still resolve correctly),
 *   - knockout matchups (placing each match into the slot of its official FIFA
 *     match number — both upcoming matchups once the draw is set, and results
 *     once played — so the schedule shows who plays whom on the right day),
 *   - penalty-shootout winners for knockout matches level after extra time.
 *
 * Providers:
 *   1. API-Football (api-sports.io) — set API_FOOTBALL_KEY. Free tier 100 req/day.
 *   2. FIFA public API (keyless) — the default fallback; opt out with
 *      DISABLE_FIFA_FALLBACK=1.
 *
 * Idempotent: a match is "owned" by the sync once its fifa_id is stored; re-syncs
 * update by fifa_id and no-op when nothing changed, so polling is cheap.
 */

import { query } from './db.js';
import { normalizeTeamName } from './team-normalize.js';
import { KNOCKOUT_OFFICIAL } from './seed-matches.js';
import { getTeamsMapCached } from './cache.js';

export interface TickerMatch {
  home: string; home_code: string; home_flag: string; home_score: number;
  away: string; away_code: string; away_flag: string; away_score: number;
  minute: string;
  /** Our group-match id (for looking up the viewer's pick); null if unresolved. */
  match_id: number | null;
  /** The viewer's 1/X/2 pick for this match, attached per-request by /api/live. */
  my_pick?: '1' | 'X' | '2' | null;
}

/**
 * Lightweight fetch of just the IN-PLAY matches (with current score + minute),
 * for the live ticker. One FIFA request returns every live game; the /api/live
 * route caches the result so the upstream API is hit at most once per cache
 * window regardless of how many people are watching.
 */
export async function fetchLiveTicker(): Promise<TickerMatch[]> {
  if (process.env.DISABLE_FIFA_FALLBACK) return [];
  const competition = process.env.FIFA_COMPETITION_ID || '17';
  const season = process.env.FIFA_SEASON_ID || '285023';
  try {
    const res = await fetch(
      `${FIFA_BASE}/calendar/matches?idCompetition=${competition}&idSeason=${season}&count=500&language=en`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const live = (data?.Results ?? []).filter((m: any) => m.MatchStatus === 3);
    if (live.length === 0) return [];

    const { rows } = await query(
      `SELECT id, name AS canon FROM teams UNION ALL SELECT team_id AS id, alias_normalized AS canon FROM team_aliases`
    );
    const resolver = new Map<string, number>();
    for (const r of rows) resolver.set(normalizeTeamName(r.canon), r.id);
    const teams = await getTeamsMapCached();
    // Map each group fixture by its unordered team pair, so a live game can be
    // tied back to our match id (live group games aren't synced with a fifa_id).
    const { rows: gmRows } = await query(`SELECT id, home_team_id, away_team_id FROM matches WHERE phase = 'group'`);
    const pairKey = (x: number, y: number) => `${Math.min(x, y)}-${Math.max(x, y)}`;
    const matchByPair = new Map<string, number>();
    for (const r of gmRows) if (r.home_team_id && r.away_team_id) matchByPair.set(pairKey(r.home_team_id, r.away_team_id), r.id);

    const side = (t: any): { id: number | null; name: string; code: string; flag: string } => {
      const fifaName = t?.TeamName?.[0]?.Description ?? t?.ShortClubName ?? '';
      const id = resolver.get(normalizeTeamName(fifaName)) ?? null;
      const ours = id != null ? (teams as Record<number, any>)[id] : null;
      // 3-letter code: FIFA's official abbreviation (MEX, ESP…), falling back to
      // the IOC country id or, last resort, the first 3 letters of the name.
      const code = (t?.Abbreviation || t?.IdCountry || fifaName.slice(0, 3)).toString().toUpperCase().slice(0, 3);
      return { id, name: ours?.name ?? fifaName, code, flag: ours?.flag_code ?? '' };
    };
    return live.map((m: any): TickerMatch => {
      const h = side(m.Home), a = side(m.Away);
      const match_id = h.id != null && a.id != null ? (matchByPair.get(pairKey(h.id, a.id)) ?? null) : null;
      return {
        home: h.name, home_code: h.code, home_flag: h.flag, home_score: m.Home?.Score ?? m.HomeTeamScore ?? 0,
        away: a.name, away_code: a.code, away_flag: a.flag, away_score: m.Away?.Score ?? m.AwayTeamScore ?? 0,
        minute: typeof m.MatchTime === 'string' ? m.MatchTime : '',
        match_id,
      };
    });
  } catch (e) {
    console.error('[live-scores] live-ticker fetch error:', e);
    return [];
  }
}

export interface NextMatch {
  home: string | null; home_flag: string | null;
  away: string | null; away_flag: string | null;
  kickoff_time: string; phase: string;
}

/** The soonest not-yet-played fixture (for the header when nothing is live). */
export async function getNextMatch(): Promise<NextMatch | null> {
  const { rows } = await query(
    `SELECT m.phase, m.kickoff_time,
            t1.name AS home, t1.flag_code AS home_flag,
            t2.name AS away, t2.flag_code AS away_flag
       FROM matches m
       LEFT JOIN teams t1 ON t1.id = m.home_team_id
       LEFT JOIN teams t2 ON t2.id = m.away_team_id
      WHERE m.status <> 'finished' AND m.kickoff_time IS NOT NULL AND m.kickoff_time > NOW()
      ORDER BY m.kickoff_time ASC
      LIMIT 1`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    home: r.home, home_flag: r.home_flag, away: r.away, away_flag: r.away_flag,
    kickoff_time: r.kickoff_time instanceof Date ? r.kickoff_time.toISOString() : String(r.kickoff_time),
    phase: r.phase,
  };
}

// official FIFA match number → which of our knockout placeholder slots it is
// (phase + 0-based index in sort_order order). Lets the sync drop a real knockout
// match into the date-correct slot instead of the first free one.
const OFFICIAL_TO_SLOT = new Map<number, { phase: string; index: number }>();
for (const { phase, officials } of KNOCKOUT_OFFICIAL) {
  officials.forEach((n, i) => OFFICIAL_TO_SLOT.set(n, { phase, index: i }));
}
async function knockoutSlotByOfficial(official: number | null): Promise<any | null> {
  if (official == null) return null;
  const loc = OFFICIAL_TO_SLOT.get(official);
  if (!loc) return null;
  const { rows } = await query(
    `SELECT * FROM matches WHERE phase = $1 ORDER BY sort_order OFFSET $2 LIMIT 1`,
    [loc.phase, loc.index]
  );
  return rows[0] ?? null;
}

// Set an upcoming/live knockout MATCHUP (teams + kickoff) onto its official slot
// without a result, so the Calendario/Resultados show who's playing before it's
// decided. Returns 'unmatched' while the teams are still placeholders (pre-draw).
async function assignKnockoutMatchup(m: LiveMatch, resolver: Map<string, number>): Promise<IngestOutcome> {
  const homeId = resolver.get(normalizeTeamName(m.home_team));
  const awayId = resolver.get(normalizeTeamName(m.away_team));
  if (!homeId || !awayId || homeId === awayId) return 'unmatched';
  const dbm = await knockoutSlotByOfficial(m.official);
  if (!dbm || dbm.status === 'finished') return 'unchanged';
  if (dbm.home_team_id === homeId && dbm.away_team_id === awayId && dbm.fifa_id === m.fifa_id) return 'unchanged';
  await query(
    `UPDATE matches SET home_team_id = $1, away_team_id = $2,
       kickoff_time = COALESCE($3, kickoff_time), fifa_id = $4
     WHERE id = $5 AND status <> 'finished'`,
    [homeId, awayId, m.kickoff_time, m.fifa_id, dbm.id]
  );
  return 'updated';
}

const _provider = process.env.API_FOOTBALL_KEY
	? 'api-football'
	: process.env.DISABLE_FIFA_FALLBACK
		? 'none'
		: 'fifa';
console.log(`[live-scores] provider: ${_provider}`);

const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';
const FIFA_BASE = 'https://api.fifa.com/api/v3';

export interface LiveMatch {
  fifa_id: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  status: 'scheduled' | 'live' | 'finished';
  phase: string;
  kickoff_time: Date | null;
  /** For knockouts level after ET: which side won (penalties). null otherwise. */
  winner_side: 'home' | 'away' | null;
  /** Official FIFA match number (1–104). Used to place a knockout match into the
   *  correct placeholder slot. null for providers that don't expose it. */
  official: number | null;
}

export interface SyncResult {
  updated: number;
  skipped: number;
  errors: number;
  /** External "Home vs Away" names we couldn't resolve to our teams. */
  unmatched: string[];
}

/** Fetch finished matches from API-Football. */
export async function fetchFromApiFootball(
  leagueId = Number(process.env.API_FOOTBALL_LEAGUE) || 1,
  season = Number(process.env.API_FOOTBALL_SEASON) || 2026,
): Promise<LiveMatch[]> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    console.warn('[live-scores] No API_FOOTBALL_KEY set, skipping API fetch');
    return [];
  }

  try {
    const res = await fetch(
      `${API_FOOTBALL_BASE}/fixtures?league=${leagueId}&season=${season}&status=FT-AET-PEN`,
      { headers: { 'x-apisports-key': apiKey } }
    );

    if (!res.ok) {
      console.error(`[live-scores] API-Football error: ${res.status}`);
      return [];
    }

    const data = await res.json();

    // API-Football reports problems INSIDE an HTTP 200 (e.g. the free plan
    // refuses season 2026: "Free plans do not have access to this season").
    // Surface them — silently returning [] made a useless key look configured.
    if (data.errors && Object.keys(data.errors).length > 0) {
      console.warn('[live-scores] API-Football returned errors:', JSON.stringify(data.errors), '— falling back to the FIFA source.');
    }

    const matches: LiveMatch[] = [];

    for (const fixture of (data.response || [])) {
      // §2.4 — Upstream "finished" matches can still arrive with null goals
      // (abandoned, walkover, ingestion lag). Skip rather than write 0-0.
      const homeScore = fixture.goals?.home;
      const awayScore = fixture.goals?.away;
      if (homeScore == null || awayScore == null) continue;
      const hw = fixture.teams?.home?.winner === true;
      const aw = fixture.teams?.away?.winner === true;
      matches.push({
        fifa_id: String(fixture.fixture.id),
        home_team: fixture.teams.home.name,
        away_team: fixture.teams.away.name,
        home_score: homeScore,
        away_score: awayScore,
        status: 'finished',
        phase: mapRoundToPhase(fixture.fixture.round),
        kickoff_time: fixture.fixture.date ? new Date(fixture.fixture.date) : null,
        winner_side: hw ? 'home' : aw ? 'away' : null,
        official: null,
      });
    }

    return matches;
  } catch (e) {
    console.error('[live-scores] fetch error:', e);
    return [];
  }
}

/**
 * Fetch from FIFA's public API (keyless). Enabled by default as the fallback
 * when no API_FOOTBALL_KEY is set; opt out with DISABLE_FIFA_FALLBACK=1.
 *
 * Endpoint + field shape verified live against the real WC2026 calendar
 * (idCompetition=17, idSeason=285023) on 2026-06-11 and against finished
 * WC2022 data for the status semantics:
 *   - MatchStatus: 0 = finished, 1 = scheduled, 3 = live
 *   - names in Home/Away.TeamName[0].Description (en-GB)
 *   - scores in Home/Away.Score (also top-level HomeTeamScore/AwayTeamScore)
 *   - shootouts: top-level Home/AwayTeamPenaltyScore; Winner = IdTeam string
 */
export async function fetchFromFifaApi(): Promise<LiveMatch[]> {
	if (process.env.DISABLE_FIFA_FALLBACK) {
		return [];
	}
	const competition = process.env.FIFA_COMPETITION_ID || '17';     // FIFA World Cup (men)
	const season = process.env.FIFA_SEASON_ID || '285023';           // World Cup 2026
	try {
		const res = await fetch(
			`${FIFA_BASE}/calendar/matches?idCompetition=${competition}&idSeason=${season}&count=500&language=en`,
			{ headers: { 'Accept': 'application/json' } }
		);

		if (!res.ok) {
			const body = await res.text().catch(() => '(unreadable)');
			console.error(`[live-scores] FIFA API error: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
			return [];
		}

		const data = await res.json();
		if (!data.Results || !Array.isArray(data.Results)) {
			console.warn('[live-scores] FIFA API unexpected response shape:', JSON.stringify(data).slice(0, 200));
			return [];
		}

		const matches: LiveMatch[] = [];

		for (const m of data.Results) {
			// MatchStatus: 0 = finished, 3 = live/in-play, anything else = scheduled.
			const status: 'finished' | 'live' | 'scheduled' =
				m.MatchStatus === 0 ? 'finished' : m.MatchStatus === 3 ? 'live' : 'scheduled';
			const homeScore = m.Home?.Score ?? m.HomeTeamScore;
			const awayScore = m.Away?.Score ?? m.AwayTeamScore;
			// Finished/live matches must carry scores (skip lagged/abandoned data);
			// scheduled matches legitimately have none — we still want them so an
			// upcoming knockout MATCHUP (teams known, not yet played) can be shown.
			if (status !== 'scheduled' && (homeScore == null || awayScore == null)) continue;
			let winner_side: 'home' | 'away' | null = null;
			if (homeScore != null && homeScore === awayScore) {
				const hp = m.HomeTeamPenaltyScore, ap = m.AwayTeamPenaltyScore;
				if (hp != null && ap != null && hp !== ap) {
					winner_side = hp > ap ? 'home' : 'away';
				} else if (m.Winner && m.Home?.IdTeam) {
					// Drawn but decided (penalties): Winner carries the IdTeam.
					winner_side = String(m.Winner) === String(m.Home.IdTeam) ? 'home' : 'away';
				}
			}
			matches.push({
				fifa_id: String(m.IdMatch),
				home_team: m.Home?.TeamName?.[0]?.Description ?? m.Home?.ShortClubName ?? '',
				away_team: m.Away?.TeamName?.[0]?.Description ?? m.Away?.ShortClubName ?? '',
				home_score: homeScore ?? 0,
				away_score: awayScore ?? 0,
				status,
				phase: mapFifaStageToPhase(String(m.IdStage)),
				kickoff_time: m.Date ? new Date(m.Date) : null,
				winner_side,
				official: m.MatchNumber != null ? Number(m.MatchNumber) : null,
			});
		}

		return matches;
	} catch (e) {
		console.error('[live-scores] FIFA API fetch error:', e);
		return [];
	}
}

/** Build a normalized-name → team_id resolver from teams + team_aliases. */
async function buildTeamResolver(): Promise<Map<string, number>> {
  const { rows } = await query(`
    SELECT id, name AS canon FROM teams
    UNION ALL
    SELECT team_id AS id, alias_normalized AS canon FROM team_aliases
  `);
  const map = new Map<string, number>();
  for (const r of rows) map.set(normalizeTeamName(r.canon), r.id);
  return map;
}

type IngestOutcome = 'updated' | 'unchanged' | 'unmatched';

/** Resolve + write a single finished external match. */
async function ingestMatch(m: LiveMatch, resolver: Map<string, number>): Promise<IngestOutcome> {
  const homeId = resolver.get(normalizeTeamName(m.home_team));
  const awayId = resolver.get(normalizeTeamName(m.away_team));
  if (!homeId || !awayId || homeId === awayId) return 'unmatched';

  // 1) Idempotent: a match we already own carries the fifa_id.
  let dbm = (await query('SELECT * FROM matches WHERE fifa_id = $1', [m.fifa_id])).rows[0] ?? null;

  if (!dbm) {
    if (m.phase === 'group') {
      // The group fixture already has both teams assigned by the seeder; find it
      // by the unordered team pair.
      dbm = (await query(
        `SELECT * FROM matches WHERE phase = 'group'
           AND ((home_team_id = $1 AND away_team_id = $2) OR (home_team_id = $2 AND away_team_id = $1))
         LIMIT 1`,
        [homeId, awayId]
      )).rows[0] ?? null;
    } else {
      // Knockout: prefer the slot matching the official FIFA match number, so the
      // match lands in its date-correct slot (the Calendario shows it on the right
      // day). Scoring keys on per-phase team membership, so slot identity never
      // affects points either way.
      if (m.official != null) dbm = await knockoutSlotByOfficial(m.official);
      // …else maybe a prior run already placed this exact pairing…
      if (!dbm) {
        dbm = (await query(
          `SELECT * FROM matches WHERE phase = $1
             AND ((home_team_id = $2 AND away_team_id = $3) OR (home_team_id = $3 AND away_team_id = $2))
           LIMIT 1`,
          [m.phase, homeId, awayId]
        )).rows[0] ?? null;
      }
      // …otherwise claim a free placeholder slot of this phase.
      if (!dbm) {
        dbm = (await query(
          `SELECT * FROM matches WHERE phase = $1
             AND home_team_id IS NULL AND away_team_id IS NULL AND fifa_id IS NULL
           ORDER BY sort_order LIMIT 1`,
          [m.phase]
        )).rows[0] ?? null;
      }
    }
  }

  if (!dbm) return 'unmatched';

  // Orientation + scores.
  let homeTeam: number, awayTeam: number, hs: number, as: number;
  if (m.phase === 'group' && dbm.home_team_id && dbm.away_team_id) {
    // Preserve our existing orientation (users predicted home/away against it).
    homeTeam = dbm.home_team_id;
    awayTeam = dbm.away_team_id;
    if (dbm.home_team_id === homeId) { hs = m.home_score; as = m.away_score; }
    else { hs = m.away_score; as = m.home_score; }
  } else {
    // Knockout / unassigned: adopt the API orientation.
    homeTeam = homeId; awayTeam = awayId; hs = m.home_score; as = m.away_score;
  }

  // Penalty winner only for knockout matches level after regulation/ET.
  let penaltyWinner: number | null = null;
  if (m.phase !== 'group' && hs === as && m.winner_side) {
    penaltyWinner = m.winner_side === 'home' ? homeId : awayId;
  }

  // No-op if nothing changed (keeps polling cheap and avoids needless rescoring).
  if (
    dbm.status === 'finished' &&
    dbm.fifa_id === m.fifa_id &&
    dbm.home_team_id === homeTeam && dbm.away_team_id === awayTeam &&
    dbm.home_score === hs && dbm.away_score === as &&
    (dbm.penalty_winner_id ?? null) === penaltyWinner
  ) {
    return 'unchanged';
  }

  await query(
    `UPDATE matches SET
       home_team_id = $1, away_team_id = $2, home_score = $3, away_score = $4,
       penalty_winner_id = $5, status = 'finished', fifa_id = $6,
       kickoff_time = COALESCE(kickoff_time, $7)
     WHERE id = $8`,
    [homeTeam, awayTeam, hs, as, penaltyWinner, m.fifa_id, m.kickoff_time, dbm.id]
  );
  return 'updated';
}

/** Sync finished results from the configured provider into our DB. */
export async function syncScores(): Promise<SyncResult> {
  let matches = await fetchFromApiFootball();
  if (matches.length === 0) matches = await fetchFromFifaApi();

  const result: SyncResult = { updated: 0, skipped: 0, errors: 0, unmatched: [] };
  if (matches.length === 0) return result;

  const resolver = await buildTeamResolver();

  for (const m of matches) {
    // §2.5 — Refuse imports with an unmapped phase; an 'unknown' phase would
    // slip past phase-filtered scoring queries.
    if (m.phase === 'unknown') { result.skipped++; continue; }
    try {
      if (m.status === 'finished') {
        const outcome = await ingestMatch(m, resolver);
        if (outcome === 'updated') result.updated++;
        else if (outcome === 'unmatched') {
          result.skipped++;
          result.unmatched.push(`${m.home_team} vs ${m.away_team}`);
          console.warn(`[live-scores] Unresolved fixture: "${m.home_team}" vs "${m.away_team}" (${m.phase}) — add a team alias.`);
        } else {
          result.skipped++; // unchanged
        }
      } else if (m.phase !== 'group' && m.official != null) {
        // Upcoming/live knockout: set the matchup so the schedule shows who's
        // playing. 'unmatched' just means the teams aren't drawn yet (pre-draw),
        // which is expected — don't add it to the warned list.
        const outcome = await assignKnockoutMatchup(m, resolver);
        if (outcome === 'updated') result.updated++;
        else result.skipped++;
      } else {
        result.skipped++; // scheduled group match (already seeded) or live group
      }
    } catch (e) {
      console.error(`[live-scores] Error ingesting fixture ${m.fifa_id}:`, e);
      result.errors++;
    }
  }

  return result;
}

export function mapRoundToPhase(round: string): string {
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

// §4.7 — FIFA World Cup 2026 stage IDs, read live from the real calendar
// (idSeason=285023) on 2026-06-11: First Stage / Round of 32 / Round of 16 /
// Quarter-final / Semi-final / Play-off for third place / Final.
const FIFA_STAGE_MAP: Record<string, string> = {
	'289273': 'group', '289287': 'r32', '289288': 'r16', '289289': 'qf',
	'289290': 'sf', '289291': '3rd', '289292': 'final',
};

function mapFifaStageToPhase(stageId: string): string {
	const phase = FIFA_STAGE_MAP[stageId];
	if (!phase) {
		console.warn(`[live-scores] Unknown FIFA stage ID: ${stageId} — defaulting to 'unknown'`);
		return 'unknown';
	}
	return phase;
}
