import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFromApiFootball, fetchFromFifaApi, syncScores } from './live-scores.js';

// Mock the database module to avoid real DB connections
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn()
}));

// Grab reference to the mocked query for write-path tests
import { query as _mockQuery } from '$lib/server/db.js';
const dbQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;

// Helper: build a minimal API-Football fixture response
function apiFixture(round: string, opts?: { home?: number; away?: number }) {
	return {
		fixture: {
			id: 1001,
			round,
			date: '2026-06-12T18:00:00Z'
		},
		teams: {
			home: { name: 'Team A' },
			away: { name: 'Team B' }
		},
		goals: {
			home: opts?.home ?? 2,
			away: opts?.away ?? 1
		}
	};
}

// Helper: build a minimal FIFA API match result (real calendar/matches shape,
// verified against the live WC2026 feed: MatchStatus 0=finished, names in
// TeamName[0].Description, penalties/Winner at the top level).
function fifaMatch(stageId: string, opts?: {
	home?: number; away?: number; status?: number;
	homePens?: number; awayPens?: number; winner?: string | null;
}) {
	return {
		IdMatch: '400021443',
		IdStage: stageId,
		Home: { TeamName: [{ Locale: 'en-GB', Description: 'Team X' }], Score: opts?.home ?? 1, IdTeam: '43911' },
		Away: { TeamName: [{ Locale: 'en-GB', Description: 'Team Y' }], Score: opts?.away ?? 0, IdTeam: '43922' },
		HomeTeamPenaltyScore: opts?.homePens ?? 0,
		AwayTeamPenaltyScore: opts?.awayPens ?? 0,
		Winner: opts?.winner ?? null,
		MatchStatus: opts?.status ?? 0,
		Date: '2026-07-05T20:00:00Z'
	};
}

describe('mapRoundToPhase (via fetchFromApiFootball)', () => {
	const originalKey = process.env.API_FOOTBALL_KEY;

	beforeEach(() => {
		process.env.API_FOOTBALL_KEY = 'test-key';
		vi.restoreAllMocks();
	});

	afterEach(() => {
		if (originalKey) {
			process.env.API_FOOTBALL_KEY = originalKey;
		} else {
			delete process.env.API_FOOTBALL_KEY;
		}
	});

	it('maps "Group Stage - Matchday 3" to "group"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Group Stage - Matchday 3')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('group');
	});

	it('maps "Round of 32" to "r32"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Round of 32')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r32');
	});

	it('maps "Round of 16" to "r16"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Round of 16')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r16');
	});

	it('maps "Quarter-finals" to "qf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Quarter-finals')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('qf');
	});

	it('maps "Semi-finals" to "sf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Semi-finals')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('sf');
	});

	it('maps "3rd Place" to "3rd"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('3rd Place')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('3rd');
	});

	it('maps "Third Place Match" to "3rd"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Third Place Match')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('3rd');
	});

	it('maps "Final" to "final"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Final')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('final');
	});

	it('maps empty string to "group" (default)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('group');
	});

	it('maps unknown round to "group" (default)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Random Round Name')] })
		}));

		const matches = await fetchFromApiFootball();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('group');
	});
});

describe('mapFifaStageToPhase (via fetchFromFifaApi)', () => {
	beforeEach(() => {
		// Make sure API_FOOTBALL_KEY is NOT set so syncScores falls through to FIFA
		delete process.env.API_FOOTBALL_KEY;
		// The FIFA source is the default fallback; make sure it isn't disabled.
		delete process.env.DISABLE_FIFA_FALLBACK;
		vi.restoreAllMocks();
	});

	afterEach(() => {
		delete process.env.DISABLE_FIFA_FALLBACK;
	});

	it('maps stage 289273 to "group"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289273')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('group');
	});

	it('maps stage 289287 to "r32"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289287')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r32');
	});

	it('maps stage 289288 to "r16"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289288')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r16');
	});

	it('maps stage 289289 to "qf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289289')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('qf');
	});

	it('maps stage 289290 to "sf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289290')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('sf');
	});

	it('maps stage 289291 to "3rd"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289291')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('3rd');
	});

	it('maps stage 289292 to "final"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('289292')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('final');
	});

	it('maps unknown stage 999999 to "unknown" and warns', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [fifaMatch('999999')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('unknown');
		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining('Unknown FIFA stage ID: 999999')
		);
	});
});

describe('fetchFromApiFootball', () => {
	it('returns empty array when API_FOOTBALL_KEY is not set', async () => {
		delete process.env.API_FOOTBALL_KEY;
		vi.restoreAllMocks();

		const matches = await fetchFromApiFootball();
		expect(matches).toEqual([]);
	});
});

describe('fetchFromApiFootball winner extraction', () => {
	beforeEach(() => { process.env.API_FOOTBALL_KEY = 'test-key'; vi.restoreAllMocks(); });
	afterEach(() => { delete process.env.API_FOOTBALL_KEY; });

	it('captures the penalty winner side from teams.*.winner', async () => {
		const fixture = {
			fixture: { id: 1, round: 'Final', date: '2026-07-19T19:00:00Z' },
			teams: { home: { name: 'Team A', winner: false }, away: { name: 'Team B', winner: true } },
			goals: { home: 1, away: 1 },
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ response: [fixture] }) }));
		const [m] = await fetchFromApiFootball();
		expect(m.winner_side).toBe('away');
		expect(m.phase).toBe('final');
	});
});

describe('syncScores', () => {
	it('returns zeros when no matches fetched from either source', async () => {
		delete process.env.API_FOOTBALL_KEY;
		vi.restoreAllMocks();

		// Mock both API sources to return no matches
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ Results: [] })
		}));

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 0, errors: 0, unmatched: [] });
	});
});

describe('syncScores write path', () => {
	const originalKey = process.env.API_FOOTBALL_KEY;

	beforeEach(() => {
		process.env.API_FOOTBALL_KEY = 'test-key';
		vi.restoreAllMocks();
		dbQuery.mockReset();
	});

	afterEach(() => {
		if (originalKey) process.env.API_FOOTBALL_KEY = originalKey;
		else delete process.env.API_FOOTBALL_KEY;
	});

	// Route the mocked `query` by SQL content, modelling a tiny DB. Defaults
	// resolve "Team A"→1, "Team B"→2.
	function routeDb(opts: {
		resolver?: { id: number; canon: string }[];
		byFifa?: any; groupPair?: any; koPair?: any; placeholder?: any;
		update?: () => Promise<any>;
	} = {}) {
		const resolver = opts.resolver ?? [{ id: 1, canon: 'Team A' }, { id: 2, canon: 'Team B' }];
		dbQuery.mockImplementation((sql: string) => {
			const s = sql.trim();
			if (sql.includes('team_aliases')) return Promise.resolve({ rows: resolver });
			if (s.startsWith('UPDATE matches')) return opts.update ? opts.update() : Promise.resolve({ rowCount: 1 });
			if (sql.includes('WHERE fifa_id =')) return Promise.resolve({ rows: opts.byFifa ? [opts.byFifa] : [] });
			if (sql.includes("phase = 'group'")) return Promise.resolve({ rows: opts.groupPair ? [opts.groupPair] : [] });
			if (sql.includes('home_team_id IS NULL')) return Promise.resolve({ rows: opts.placeholder ? [opts.placeholder] : [] });
			if (sql.includes('phase = $1')) return Promise.resolve({ rows: opts.koPair ? [opts.koPair] : [] });
			return Promise.resolve({ rows: [] });
		});
	}
	const stubFetch = (fixtures: any[]) =>
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ response: fixtures }) }));
	const updateParams = () =>
		dbQuery.mock.calls.filter(c => String(c[0]).trim().startsWith('UPDATE matches')).map(c => c[1]);

	it('imports a group result, preserving our home/away orientation', async () => {
		stubFetch([apiFixture('Group Stage - Matchday 1', { home: 3, away: 2 })]); // home=Team A, away=Team B
		routeDb({ groupPair: { id: 10, phase: 'group', home_team_id: 1, away_team_id: 2, status: 'scheduled', fifa_id: null, home_score: null, away_score: null, penalty_winner_id: null } });

		const result = await syncScores();
		expect(result).toEqual({ updated: 1, skipped: 0, errors: 0, unmatched: [] });
		const [home, away, hs, as, pen, , , id] = updateParams()[0];
		expect([home, away, hs, as, pen, id]).toEqual([1, 2, 3, 2, null, 10]);
	});

	it('swaps the score when our stored group orientation is reversed', async () => {
		stubFetch([apiFixture('Group Stage', { home: 3, away: 2 })]); // API home=Team A(1)
		routeDb({ groupPair: { id: 10, phase: 'group', home_team_id: 2, away_team_id: 1, status: 'scheduled', fifa_id: null, home_score: null, away_score: null, penalty_winner_id: null } });

		await syncScores();
		const [home, away, hs, as] = updateParams()[0];
		// Our home is team 2, so the 3-2 (A-B) result is stored as 2-3.
		expect([home, away, hs, as]).toEqual([2, 1, 2, 3]);
	});

	it('assigns a knockout matchup to a free placeholder and records the penalty winner', async () => {
		const fixture = {
			fixture: { id: 9001, round: 'Final', date: '2026-07-19T19:00:00Z' },
			teams: { home: { name: 'Team A', winner: false }, away: { name: 'Team B', winner: true } },
			goals: { home: 1, away: 1 }, // level → decided on penalties, Team B wins
		};
		stubFetch([fixture]);
		routeDb({ placeholder: { id: 50, phase: 'final', home_team_id: null, away_team_id: null, status: 'scheduled', fifa_id: null } });

		const result = await syncScores();
		expect(result.updated).toBe(1);
		const [home, away, hs, as, pen, fifaId, , id] = updateParams()[0];
		expect([home, away, hs, as, pen, fifaId, id]).toEqual([1, 2, 1, 1, 2, '9001', 50]);
	});

	it('no-ops on an unchanged finished match (idempotent re-sync)', async () => {
		stubFetch([apiFixture('Group Stage', { home: 3, away: 2 })]); // fifa_id 1001
		routeDb({ byFifa: { id: 10, phase: 'group', home_team_id: 1, away_team_id: 2, home_score: 3, away_score: 2, status: 'finished', fifa_id: '1001', penalty_winner_id: null } });

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0, unmatched: [] });
		expect(updateParams()).toHaveLength(0); // no write
	});

	it('reports unmatched fixtures when a team name cannot be resolved', async () => {
		stubFetch([apiFixture('Group Stage', { home: 1, away: 0 })]);
		routeDb({ resolver: [{ id: 1, canon: 'Team A' }] }); // Team B missing

		const result = await syncScores();
		expect(result.updated).toBe(0);
		expect(result.unmatched).toEqual(['Team A vs Team B']);
		expect(updateParams()).toHaveLength(0);
	});

	it('reports unmatched when no DB match or free placeholder is found', async () => {
		stubFetch([apiFixture('Round of 16', { home: 2, away: 1 })]);
		routeDb({}); // no byFifa, no koPair, no placeholder

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0, unmatched: ['Team A vs Team B'] });
	});

	it('counts an error when the write throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		stubFetch([apiFixture('Final', { home: 2, away: 1 })]);
		routeDb({ groupPair: null, placeholder: { id: 7, phase: 'final', home_team_id: null, away_team_id: null, fifa_id: null }, update: () => Promise.reject(new Error('DB write failed')) });

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 0, errors: 1, unmatched: [] });
	});

	it('skips live matches without writing', async () => {
		delete process.env.API_FOOTBALL_KEY;
		delete process.env.DISABLE_FIFA_FALLBACK;
		// MatchStatus 3 = live (in play) on the real FIFA feed.
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ Results: [fifaMatch('289273', { home: 1, away: 1, status: 3 })] }) }));
		routeDb({});

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0, unmatched: [] });
		expect(updateParams()).toHaveLength(0);
	});

	it('FIFA: penalty shootout winner derived from penalty scores', async () => {
		delete process.env.API_FOOTBALL_KEY;
		delete process.env.DISABLE_FIFA_FALLBACK;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ Results: [fifaMatch('289292', { home: 1, away: 1, homePens: 3, awayPens: 4 })] }) }));
		const [m] = await fetchFromFifaApi();
		expect(m.winner_side).toBe('away');
		expect(m.phase).toBe('final');
		expect(m.status).toBe('finished');
	});

	it('FIFA: drawn-but-decided falls back to the Winner team id', async () => {
		delete process.env.API_FOOTBALL_KEY;
		delete process.env.DISABLE_FIFA_FALLBACK;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ Results: [fifaMatch('289290', { home: 2, away: 2, winner: '43911' })] }) }));
		const [m] = await fetchFromFifaApi();
		expect(m.winner_side).toBe('home'); // 43911 = Home.IdTeam in the fixture helper
	});
});
