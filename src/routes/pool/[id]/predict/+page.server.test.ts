import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from './+page.server.ts';

vi.mock('$lib/server/queries.js', () => ({
	getPoolById: vi.fn(),
	getAllTeams: vi.fn(),
	createPrediction: vi.fn(),
	getUserPredictions: vi.fn(),
	getGroupPredictions: vi.fn(),
}));

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn(),
}));

import { getPoolById, getAllTeams, createPrediction, getUserPredictions, getGroupPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';

const mockParams = (id: string) => ({ id });
const mockLocals = (userId: number) => ({ user: { id: userId } });
const mockUrl = (searchParams?: Record<string, string>) => {
	const url = new URL('http://localhost/pool/1/predict');
	if (searchParams) {
		for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
	}
	return url;
};

const defaultPool = { id: 1, deadline_group: null };
const defaultPrediction = { id: 10, label: 'Principal', total_score: 5 };

/**
 * Sets up the common mock chain for a standard load call that has
 * one existing prediction and no special deadline.
 *
 * Call order in load():
 *   1. getPoolById → pool
 *   2. getAllTeams → teams[]
 *   3. getUserPredictions → predictions[]
 *   4. (if no preds) query → membership check
 *   5. query → knockout matches
 *   6. (if selectedPrediction) getGroupPredictions → group pred rows
 *   7. (if selectedPrediction) query → match predictions
 */
function setupDefaultMocks(overrides: {
	pool?: any;
	teams?: any[];
	predictions?: any[];
	knockoutRows?: any[];
	groupPredRows?: any[];
	matchPredRows?: any[];
} = {}) {
	const pool = overrides.pool ?? defaultPool;
	const teams = overrides.teams ?? [];
	const predictions = overrides.predictions ?? [defaultPrediction];
	const knockoutRows = overrides.knockoutRows ?? [];
	const groupPredRows = overrides.groupPredRows ?? [];
	const matchPredRows = overrides.matchPredRows ?? [];

	(getPoolById as any).mockResolvedValue(pool);
	(getAllTeams as any).mockResolvedValue(teams);
	(getUserPredictions as any).mockResolvedValue(predictions);
	(query as any).mockResolvedValueOnce({ rows: knockoutRows }); // knockout matches query
	(getGroupPredictions as any).mockResolvedValue(groupPredRows);
	(query as any).mockResolvedValueOnce({ rows: matchPredRows }); // match predictions query
}

describe('predict page load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// 1. Redirects to /login when not authenticated
	it('redirects to /login when not authenticated', async () => {
		try {
			await load({
				params: mockParams('1'),
				locals: {} as any,
				url: mockUrl(),
			} as any);
			expect.fail('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(302);
			expect(e.location).toBe('/login');
		}
	});

	// 2. Throws 404 when pool not found
	it('throws 404 when pool not found', async () => {
		(getPoolById as any).mockResolvedValue(null);
		try {
			await load({
				params: mockParams('999'),
				locals: mockLocals(1) as any,
				url: mockUrl(),
			} as any);
			expect.fail('Should have thrown');
		} catch (e: any) {
			expect(e.status).toBe(404);
		}
	});

	// 3. Returns teamsByGroup correctly grouped
	it('returns teamsByGroup correctly grouped', async () => {
		setupDefaultMocks({
			teams: [
				{ id: 1, name: 'Team A1', group_name: 'A' },
				{ id: 2, name: 'Team A2', group_name: 'A' },
				{ id: 3, name: 'Team B1', group_name: 'B' },
			],
		});

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(Object.keys(result.teamsByGroup)).toEqual(['A', 'B']);
		expect(result.teamsByGroup['A']).toHaveLength(2);
		expect(result.teamsByGroup['B']).toHaveLength(1);
		expect(result.teamsByGroup['A'][0].name).toBe('Team A1');
	});

	// 4. Returns empty teamsByGroup when no teams
	it('returns empty teamsByGroup when no teams', async () => {
		setupDefaultMocks({ teams: [] });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.teamsByGroup).toEqual({});
	});

	// 5. Returns existing predictions as entries
	it('returns existing predictions as entries', async () => {
		const preds = [
			{ id: 10, label: 'Principal', total_score: 5 },
			{ id: 11, label: 'Alt', total_score: 3 },
		];
		setupDefaultMocks({ predictions: preds });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.entries).toHaveLength(2);
		expect(result.entries[0]).toEqual({ id: 10, label: 'Principal', total_score: 5 });
		expect(result.entries[1]).toEqual({ id: 11, label: 'Alt', total_score: 3 });
	});

	// 6. Auto-creates prediction when user is member with no predictions
	it('auto-creates prediction when user is member with no predictions', async () => {
		(getPoolById as any).mockResolvedValue(defaultPool);
		(getAllTeams as any).mockResolvedValue([]);
		// First getUserPredictions returns [], second returns the newly created one
		(getUserPredictions as any)
			.mockResolvedValueOnce([]) // first call: no predictions yet
			.mockResolvedValueOnce([{ id: 99, label: '', total_score: 0 }]); // after create
		// query call sequence:
		//   1st: membership check → is a member
		//   2nd: knockout matches → empty
		//   3rd: match predictions → empty
		(query as any)
			.mockResolvedValueOnce({ rows: [{ 1: 1 }] }) // membership check: is a member
			.mockResolvedValueOnce({ rows: [] }) // knockout matches
			.mockResolvedValueOnce({ rows: [] }); // match predictions
		(createPrediction as any).mockResolvedValue(undefined);
		(getGroupPredictions as any).mockResolvedValue([]);

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(createPrediction).toHaveBeenCalledWith(1, 1, '');
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0].id).toBe(99);
	});

	// 7. Does NOT auto-create when user is NOT a member
	it('does not auto-create prediction when user is not a member', async () => {
		(getPoolById as any).mockResolvedValue(defaultPool);
		(getAllTeams as any).mockResolvedValue([]);
		(getUserPredictions as any).mockResolvedValue([]); // no predictions
		// query call sequence:
		//   1st: membership check → NOT a member
		//   2nd: knockout matches → empty
		(query as any)
			.mockResolvedValueOnce({ rows: [] }) // membership check: NOT a member
			.mockResolvedValueOnce({ rows: [] }); // knockout matches

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(createPrediction).not.toHaveBeenCalled();
		expect(result.entries).toEqual([]);
		expect(result.selectedId).toBeNull();
	});

	// 8. Sets isLocked=true when deadline_group is in the past
	it('sets isLocked=true when deadline_group is in the past', async () => {
		const pastDate = new Date('2020-01-01').toISOString();
		setupDefaultMocks({ pool: { id: 1, deadline_group: pastDate } });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.isLocked).toBe(true);
	});

	// 9. Sets isLocked=false when deadline_group is in the future
	it('sets isLocked=false when deadline_group is in the future', async () => {
		const futureDate = new Date('2099-12-31').toISOString();
		setupDefaultMocks({ pool: { id: 1, deadline_group: futureDate } });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.isLocked).toBe(false);
	});

	// 10. Sets isLocked=false when no deadline_group
	it('sets isLocked=false when no deadline_group', async () => {
		setupDefaultMocks({ pool: { id: 1, deadline_group: null } });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.isLocked).toBe(false);
	});

	// 11. Selects prediction by entry query param
	it('selects prediction by entry query param', async () => {
		const preds = [
			{ id: 10, label: 'Principal', total_score: 5 },
			{ id: 11, label: 'Alt', total_score: 3 },
		];
		setupDefaultMocks({ predictions: preds });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl({ entry: 'Alt' }),
		} as any);

		expect(result.selectedLabel).toBe('Alt');
		expect(result.selectedId).toBe(11);
	});

	// 12. Falls back to first prediction when entry param doesn't match
	it('falls back to first prediction when entry param does not match', async () => {
		const preds = [
			{ id: 10, label: 'Principal', total_score: 5 },
			{ id: 11, label: 'Alt', total_score: 3 },
		];
		setupDefaultMocks({ predictions: preds });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl({ entry: 'NonExistent' }),
		} as any);

		expect(result.selectedLabel).toBe('Principal');
		expect(result.selectedId).toBe(10);
	});

	// 13. Returns knockoutByPhase correctly grouped
	it('returns knockoutByPhase correctly grouped', async () => {
		const knockoutRows = [
			{ id: 1, phase: 'r16', home_team_id: 1, away_team_id: 2, home_name: 'A', home_flag: 'a', away_name: 'B', away_flag: 'b' },
			{ id: 2, phase: 'r16', home_team_id: 3, away_team_id: 4, home_name: 'C', home_flag: 'c', away_name: 'D', away_flag: 'd' },
			{ id: 3, phase: 'qf', home_team_id: 5, away_team_id: 6, home_name: 'E', home_flag: 'e', away_name: 'F', away_flag: 'f' },
		];
		setupDefaultMocks({ knockoutRows });

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(Object.keys(result.knockoutByPhase)).toEqual(['r16', 'qf']);
		expect(result.knockoutByPhase['r16']).toHaveLength(2);
		expect(result.knockoutByPhase['qf']).toHaveLength(1);
	});

	// 14. Returns existing group and match predictions for selected entry
	it('returns existing group and match predictions for selected entry', async () => {
		setupDefaultMocks({
			groupPredRows: [
				{ group_name: 'A', position_1: 10, position_2: 20, position_3: 30, position_4: 40 },
			],
			matchPredRows: [
				{ match_id: 5, home_score: 2, away_score: 1 },
				{ match_id: 6, home_score: 0, away_score: 3 },
			],
		});

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.existingGroupPreds['A']).toEqual({
			pos1: 10, pos2: 20, pos3: 30, pos4: 40,
		});
		expect(result.existingMatchPreds[5]).toEqual({ home_score: 2, away_score: 1 });
		expect(result.existingMatchPreds[6]).toEqual({ home_score: 0, away_score: 3 });
	});

	// 15. Returns empty existing predictions when no selected prediction
	it('returns empty existing predictions when no selected prediction', async () => {
		(getPoolById as any).mockResolvedValue(defaultPool);
		(getAllTeams as any).mockResolvedValue([]);
		(getUserPredictions as any).mockResolvedValue([]); // no predictions
		(query as any)
			.mockResolvedValueOnce({ rows: [] }) // membership check: not a member
			.mockResolvedValueOnce({ rows: [] }); // knockout matches

		const result = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.existingGroupPreds).toEqual({});
		expect(result.existingMatchPreds).toEqual({});
		expect(result.selectedId).toBeNull();
		expect(getGroupPredictions).not.toHaveBeenCalled();
	});
});
