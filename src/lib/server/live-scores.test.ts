import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchFromApiFootball, fetchFromFifaApi, syncScores } from './live-scores.js';

// Mock the database module to avoid real DB connections
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn()
}));

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
