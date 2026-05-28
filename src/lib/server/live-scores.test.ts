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

// Helper: build a minimal FIFA API match result
function fifaMatch(stageId: string, opts?: { home?: number; away?: number; status?: string }) {
	return {
		idMatch: 2001,
		idStage: stageId,
		home: { teamName: 'Team X', score: opts?.home ?? 1 },
		away: { teamName: 'Team Y', score: opts?.away ?? 0 },
		matchStatus: opts?.status ?? 'Completed',
		date: '2026-07-05T20:00:00Z'
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
		vi.restoreAllMocks();
	});

	it('maps stage 285063 to "group"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285063')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('group');
	});

	it('maps stage 285064 to "r32"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285064')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r32');
	});

	it('maps stage 285065 to "r16"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285065')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('r16');
	});

	it('maps stage 285066 to "qf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285066')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('qf');
	});

	it('maps stage 285067 to "sf"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285067')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('sf');
	});

	it('maps stage 285068 to "3rd"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285068')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('3rd');
	});

	it('maps stage 285069 to "final"', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285069')] })
		}));

		const matches = await fetchFromFifaApi();
		expect(matches).toHaveLength(1);
		expect(matches[0].phase).toBe('final');
	});

	it('maps unknown stage 999999 to "unknown" and warns', async () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('999999')] })
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

describe('syncScores', () => {
	it('returns zeros when no matches fetched from either source', async () => {
		delete process.env.API_FOOTBALL_KEY;
		vi.restoreAllMocks();

		// Mock both API sources to return no matches
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [] })
		}));

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 0, errors: 0 });
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
		if (originalKey) {
			process.env.API_FOOTBALL_KEY = originalKey;
		} else {
			delete process.env.API_FOOTBALL_KEY;
		}
	});

	it('updates match found by fifa_id', async () => {
		// API-Football returns one finished match
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Group Stage - Matchday 1', { home: 3, away: 2 })] })
		}));

		// query is called twice: SELECT by fifa_id (returns match), then UPDATE
		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 10, fifa_id: '1001' }] }) // SELECT by fifa_id
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

		const result = await syncScores();
		expect(result).toEqual({ updated: 1, skipped: 0, errors: 0 });

		// Verify the SELECT used fifa_id
		expect(dbQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('fifa_id'), ['1001']);
		// Verify the UPDATE set scores
		expect(dbQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE matches'), [3, 2, 10, expect.any(Date)]);
	});

	it('skips match when already finished (UPDATE returns rowCount 0)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Group Stage')] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 10, fifa_id: '1001' }] }) // SELECT
			.mockResolvedValueOnce({ rowCount: 0 }); // UPDATE — already finished

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0 });
	});

	it('falls back to team name alias CTE match when no fifa_id match', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Group Stage', { home: 1, away: 0 })] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [] }) // SELECT by fifa_id — no match
			.mockResolvedValueOnce({ rows: [{ id: 20 }] }) // SELECT by CTE resolver — found
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

		const result = await syncScores();
		expect(result).toEqual({ updated: 1, skipped: 0, errors: 0 });

		// Second query should be the CTE resolver query
		expect(dbQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('resolver'), expect.arrayContaining(['team a', 'team b']));
	});

	it('skips live matches (status !== finished)', async () => {
		// Return a match that is NOT finished (use FIFA API format with non-Completed status)
		delete process.env.API_FOOTBALL_KEY; // skip API-Football, go to FIFA
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ results: [fifaMatch('285063', { home: 1, away: 1, status: 'Live' })] })
		}));

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0 });
		// No DB queries should have been made
		expect(dbQuery).not.toHaveBeenCalled();
	});

	it('skips when no match found at all', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Group Stage')] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [] }) // SELECT by fifa_id — no match
			.mockResolvedValueOnce({ rows: [] }); // SELECT by CTE resolver — no match

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 1, errors: 0 });
	});

	it('increments error count when UPDATE throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Final', { home: 2, away: 1 })] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 5, fifa_id: '1001' }] }) // SELECT
			.mockRejectedValueOnce(new Error('DB write failed')); // UPDATE throws

		const result = await syncScores();
		expect(result).toEqual({ updated: 0, skipped: 0, errors: 1 });
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('5'), expect.any(Error));
	});

	it('processes multiple matches and returns correct totals', async () => {
		const fixture1 = apiFixture('Group Stage - Matchday 1', { home: 2, away: 0 });
		const fixture2 = apiFixture('Group Stage - Matchday 2', { home: 1, away: 1 });
		// Give different fixture IDs so they have different fifa_ids
		fixture2.fixture.id = 1002;

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [fixture1, fixture2] })
		}));

		// Match 1: found by fifa_id, updated
		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 10 }] }) // SELECT match1 by fifa_id
			.mockResolvedValueOnce({ rowCount: 1 }) // UPDATE match1
			// Match 2: not found by fifa_id, not found by CTE resolver either
			.mockResolvedValueOnce({ rows: [] }) // SELECT match2 by fifa_id
			.mockResolvedValueOnce({ rows: [] }); // SELECT match2 by CTE resolver

		const result = await syncScores();
		expect(result).toEqual({ updated: 1, skipped: 1, errors: 0 });
	});

	it('sets kickoff_time via COALESCE when available', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [apiFixture('Semi-finals', { home: 1, away: 0 })] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 42 }] }) // SELECT
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

		await syncScores();

		// Verify UPDATE was called with a Date object for kickoff_time
		const updateCall = dbQuery.mock.calls[1];
		expect(updateCall[1][3]).toBeInstanceOf(Date);
		expect(updateCall[0]).toContain('COALESCE(kickoff_time');
	});

	it('handles null kickoff_time correctly', async () => {
		// Build a fixture with no date → kickoff_time should be null
		const fixture = apiFixture('Final', { home: 0, away: 0 });
		fixture.fixture.date = null;

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [fixture] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [{ id: 99 }] }) // SELECT
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

		await syncScores();

		const updateCall = dbQuery.mock.calls[1];
		// kickoff_time parameter should be null
		expect(updateCall[1][3]).toBeNull();
	});

	it('escapes LIKE wildcards in team names via CTE resolver', async () => {
		// Create fixture with team names containing special characters
		const fixture = {
			fixture: { id: 3001, round: 'Group Stage', date: '2026-06-14T20:00:00Z' },
			teams: { home: { name: '100% Winners_FC' }, away: { name: 'Team_B' } },
			goals: { home: 2, away: 1 }
		};

		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ response: [fixture] })
		}));

		dbQuery
			.mockResolvedValueOnce({ rows: [] }) // SELECT by fifa_id — no match
			.mockResolvedValueOnce({ rows: [{ id: 50 }] }) // SELECT by CTE resolver — found
			.mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

		const result = await syncScores();
		expect(result).toEqual({ updated: 1, skipped: 0, errors: 0 });

		// Verify the CTE resolver query was called with normalized team names
		const resolverCall = dbQuery.mock.calls[1];
		expect(resolverCall[0]).toContain('resolver');
		// The normalization lowercases, strips diacritics, collapses spaces
		// but does NOT escape LIKE wildcards (CTE uses exact match, not LIKE)
		const params = resolverCall[1] as string[];
		expect(params[0]).toBe('100% winners_fc');
		expect(params[1]).toBe('team_b');
	});
});
