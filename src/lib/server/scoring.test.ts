import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

// Must create mocks INSIDE the factory — vi.mock is hoisted above all declarations
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn()
}));

// Grab references after mock setup
import { query as _mockQuery, getClient as _mockGetClient } from '$lib/server/db.js';

const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = _mockGetClient as unknown as ReturnType<typeof vi.fn>;

import {
	calculateMatchScores,
	calculateGroupScores,
	calculateBracketScores,
	calculateAllScores
} from './scoring.js';

const DEFAULT_RULES: Record<string, number> = {
	match_outcome: 1,
	exact_score: 3,
	group_position: 2,
	knockout_r32: 2,
	knockout_r16: 3,
	knockout_qf: 4,
	knockout_sf: 6,
	knockout_final: 6,
	knockout_winner: 8,
	third_place: 6
};

// ── calculateMatchScores ──────────────────────────────────────────────────

describe('calculateMatchScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	it('awards match_outcome points for correct outcome (not exact score)', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0 }]
			})
			.mockResolvedValueOnce({
				rows: [{ id: 100, prediction_id: 50, match_id: 1, home_score: 3, away_score: 1 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);

		// Call 2 = bulk update with unnest arrays
		const updateCall = clientQuery.mock.calls[2];
		expect(updateCall[0]).toContain('UPDATE match_predictions');
		const params = updateCall[1] as number[][];
		// Last array is the points array
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.match_outcome]); // [1]
	});

	it('awards match_outcome + exact_score for exact scoreline', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ id: 100, prediction_id: 50, match_id: 1, home_score: 2, away_score: 1 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as number[][];
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.match_outcome + DEFAULT_RULES.exact_score]); // [4]
	});

	it('awards 0 points for wrong prediction', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 0, away_score: 2 }]
			})
			.mockResolvedValueOnce({
				rows: [{ id: 100, prediction_id: 50, match_id: 1, home_score: 1, away_score: 0 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as number[][];
		expect(params[params.length - 1]).toEqual([0]);
	});

	it('awards match_outcome for correct draw (different exact score)', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ id: 100, prediction_id: 50, match_id: 1, home_score: 0, away_score: 0 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as number[][];
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.match_outcome]); // [1]
	});
});

// ── calculateGroupScores ──────────────────────────────────────────────────

describe('calculateGroupScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	it('awards 4 × group_position when all positions correct', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{ group_name: 'A', home_team_id: 10, away_team_id: 20, home_score: 5, away_score: 0 },
					{ group_name: 'A', home_team_id: 30, away_team_id: 40, home_score: 1, away_score: 2 }
				]
			})
			.mockResolvedValueOnce({
				rows: [
					{
						prediction_id: 50,
						group_name: 'A',
						position_1: 10,
						position_2: 40,
						position_3: 30,
						position_4: 20
					}
				]
			})
			.mockResolvedValueOnce({ rowCount: 1 }) // B6-5: reset points to 0
			.mockResolvedValueOnce({ rowCount: 1 }); // bulk unnest update

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[3];
		const params = updateCall[1] as any[];
		// unnest($1::int[], $2::text[], $3::int[]) — last array is points
		expect(params[params.length - 1]).toEqual([4 * DEFAULT_RULES.group_position]); // [8]
	});

	it('awards points only for correctly predicted positions', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{ group_name: 'A', home_team_id: 10, away_team_id: 20, home_score: 5, away_score: 0 },
					{ group_name: 'A', home_team_id: 30, away_team_id: 40, home_score: 1, away_score: 2 }
				]
			})
			.mockResolvedValueOnce({
				rows: [
					{
						prediction_id: 50,
						group_name: 'A',
						position_1: 10,
						position_2: 20, // actual: 40
						position_3: 40, // actual: 30
						position_4: 30  // actual: 20
					}
				]
			})
			.mockResolvedValueOnce({ rowCount: 1 }) // B6-5: reset points to 0
			.mockResolvedValueOnce({ rowCount: 1 }); // bulk unnest update

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[3];
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([1 * DEFAULT_RULES.group_position]); // [2]
	});

	it('skips scoring when no matches are finished', async () => {
		clientQuery.mockResolvedValueOnce({ rows: [] });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);

		// Only 1 call (matches query), no update issued
		expect(clientQuery).toHaveBeenCalledTimes(1);
	});

	it('resets points to 0 before recalculating (B6-5 idempotency)', async () => {
		// 4 matches in group A: team 10 beats 20 (3-0), team 10 beats 30 (2-1),
		// team 40 beats 20 (1-0), team 40 draws with 30 (1-1)
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{ group_name: 'A', home_team_id: 10, away_team_id: 20, home_score: 3, away_score: 0 },
					{ group_name: 'A', home_team_id: 10, away_team_id: 30, home_score: 2, away_score: 1 },
					{ group_name: 'A', home_team_id: 40, away_team_id: 20, home_score: 1, away_score: 0 },
					{ group_name: 'A', home_team_id: 40, away_team_id: 30, home_score: 1, away_score: 1 }
				]
			})
			.mockResolvedValueOnce({
				rows: [
					{ prediction_id: 50, group_name: 'A', position_1: 10, position_2: 40, position_3: 30, position_4: 20 }
				]
			})
			.mockResolvedValueOnce({ rowCount: 1 }) // B6-5: reset all to 0
			.mockResolvedValueOnce({ rowCount: 1 }); // bulk update

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);

		// Verify B6-5 reset query ran (call index 2)
		const resetCall = clientQuery.mock.calls[2];
		expect(resetCall[0]).toContain('SET points_earned = 0');

		// Then verify the bulk update (call index 3)
		const updateCall = clientQuery.mock.calls[3];
		expect(updateCall[0]).toContain('UPDATE group_predictions');
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([4 * DEFAULT_RULES.group_position]); // all 4 correct
	});

	it('breaks group ties by goal difference, then goals for', async () => {
		// Group A: team 10 = 3pts (GD +3), team 20 = 3pts (GD +1), team 30 = 0pts, team 40 = 0pts
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{ group_name: 'A', home_team_id: 10, away_team_id: 30, home_score: 4, away_score: 0 }, // 10 wins big
					{ group_name: 'A', home_team_id: 20, away_team_id: 40, home_score: 2, away_score: 1 }, // 20 wins small
					{ group_name: 'A', home_team_id: 30, away_team_id: 20, home_score: 0, away_score: 2 }, // 20 wins
					{ group_name: 'A', home_team_id: 40, away_team_id: 10, home_score: 1, away_score: 3 }  // 10 wins
				]
			})
			.mockResolvedValueOnce({
				rows: [
					// Predict team 10 first (correct by GD), team 20 second (correct)
					{ prediction_id: 50, group_name: 'A', position_1: 10, position_2: 20, position_3: 30, position_4: 40 }
				]
			})
			.mockResolvedValueOnce({ rowCount: 1 }) // B6-5: reset
			.mockResolvedValueOnce({ rowCount: 1 }); // bulk update

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[3];
		const params = updateCall[1] as any[];
		// 10 is 1st (correct: +2), 20 is 2nd (correct: +2), 30/40 wrong (0 each) = 4 total
		expect(params[params.length - 1]).toEqual([2 * DEFAULT_RULES.group_position]); // [4]
	});
});

// ── calculateBracketScores ────────────────────────────────────────────────

describe('calculateBracketScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	it('awards phase-specific points for correct knockout winner', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: 'qf',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 2,
						away_score: 1
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: 'qf', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		// unnest($1::int[], $2::text[], $3::int[], $4::int[]) — last array is points
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.knockout_qf]); // [4]
	});

	it('awards knockout_final + knockout_winner bonus for correct final winner', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: 'final',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 1,
						away_score: 0
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: 'final', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.knockout_final + DEFAULT_RULES.knockout_winner]); // [14]
	});

	it('awards 0 points for wrong team', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: 'sf',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 3,
						away_score: 0
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: 'sf', team_id: 20 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([0]);
	});

	it('awards points to penalty winner when scores are level', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: 'qf',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 1,
						away_score: 1,
						penalty_winner_id: 10
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: 'qf', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.knockout_qf]); // [4]
	});

	it('skips match when draw has no penalty winner recorded', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: 'sf',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 2,
						away_score: 2,
						penalty_winner_id: null
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: 'sf', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		// No phase winners → all predictions get 0 points
		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		expect(params[params.length - 1]).toEqual([0]);
	});

	it('uses third_place rule for 3rd-place match (not knockout_3rd)', async () => {
		clientQuery
			.mockResolvedValueOnce({
				rows: [
					{
						id: 1,
						phase: '3rd',
						home_team_id: 10,
						away_team_id: 20,
						home_score: 3,
						away_score: 1,
						penalty_winner_id: null
					}
				]
			})
			.mockResolvedValueOnce({
				rows: [{ prediction_id: 50, phase: '3rd', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 });

		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);

		const updateCall = clientQuery.mock.calls[2];
		const params = updateCall[1] as any[];
		// '3rd' phase maps to 'third_place' rule, NOT 'knockout_3rd' (which doesn't exist)
		expect(params[params.length - 1]).toEqual([DEFAULT_RULES.third_place]); // [6]
	});
});

// ── calculateAllScores ────────────────────────────────────────────────────

describe('calculateAllScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;
	let clientRelease: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
		clientRelease = vi.fn();
		mockGetClient.mockResolvedValue({
			query: clientQuery,
			release: clientRelease
		});
	});

	it('runs all phases in a transaction and commits', async () => {
		// getScoringRules returns empty → uses DEFAULT_RULES
		mockQuery.mockResolvedValueOnce({ rows: [] });

		// client.query calls: BEGIN, advisory lock, group-matches, bracket-matches, match-matches, total-update, COMMIT
		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ acquired: true }] }) // B6-3: advisory lock
			.mockResolvedValueOnce({ rows: [] }) // group matches (empty → early return)
			.mockResolvedValueOnce({ rows: [] }) // bracket matches (empty → early return)
			.mockResolvedValueOnce({ rows: [] }) // match matches (empty → early return)
			.mockResolvedValueOnce({ rows: [] }) // total score update
			.mockResolvedValueOnce({ rows: [] }); // COMMIT

		// Post-commit pool tracking
		mockQuery.mockResolvedValueOnce({ rows: [] });

		await calculateAllScores(1);

		expect(clientQuery).toHaveBeenCalledTimes(7);
		expect(clientQuery.mock.calls[0][0]).toContain('BEGIN');
		expect(clientQuery.mock.calls[1][0]).toContain('pg_try_advisory_xact_lock');
		expect(clientQuery.mock.calls[6][0]).toContain('COMMIT');
		expect(clientRelease).toHaveBeenCalled();
	});

	it('rolls back on error and re-throws', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [] }) // getScoringRules
			.mockResolvedValueOnce({ rows: [] }); // error tracking in catch

		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ acquired: true }] }) // B6-3: advisory lock
			.mockRejectedValueOnce(new Error('DB connection lost')); // group matches → throws

		await expect(calculateAllScores(1)).rejects.toThrow('DB connection lost');

		const rollbackCall = clientQuery.mock.calls.find(
			(c: [string]) => typeof c[0] === 'string' && c[0].includes('ROLLBACK')
		);
		expect(rollbackCall).toBeTruthy();
		expect(clientRelease).toHaveBeenCalled();
	});

	it('skips scoring gracefully when advisory lock not acquired', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [] }); // getScoringRules

		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ acquired: false }] }) // lock NOT acquired
			.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

		await calculateAllScores(1);

		// Only BEGIN + lock check + ROLLBACK — no scoring queries
		expect(clientQuery).toHaveBeenCalledTimes(3);
		expect(clientQuery.mock.calls[2][0]).toContain('ROLLBACK');
		expect(clientRelease).toHaveBeenCalled();
	});

	it('uses custom scoring rules from DB when provided', async () => {
		// getScoringRules returns a custom override for knockout_qf
		mockQuery
			.mockResolvedValueOnce({ rows: [{ rule: 'knockout_qf', points: 10 }] }) // custom rules
			.mockResolvedValueOnce({ rows: [] }); // post-commit tracking

		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ acquired: true }] }) // advisory lock
			.mockResolvedValueOnce({ rows: [] }) // group matches (empty)
			.mockResolvedValueOnce({ // bracket matches (1 QF match, home wins)
				rows: [{
					id: 1, phase: 'qf', home_team_id: 10, away_team_id: 20,
					home_score: 2, away_score: 1, penalty_winner_id: null
				}]
			})
			.mockResolvedValueOnce({ // bracket predictions (correct QF pick)
				rows: [{ prediction_id: 50, phase: 'qf', team_id: 10 }]
			})
			.mockResolvedValueOnce({ rowCount: 1 }) // bracket bulk update
			.mockResolvedValueOnce({ rows: [] }) // match matches (empty)
			.mockResolvedValueOnce({ rows: [] }) // total score update
			.mockResolvedValueOnce({ rows: [] }); // COMMIT

		await calculateAllScores(1);

		// Verify the bracket update used the overridden value (10, not default 4)
		const bracketUpdateCall = clientQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE bracket_predictions')
		);
		expect(bracketUpdateCall).toBeTruthy();
		const params = bracketUpdateCall![1] as any[];
		expect(params[params.length - 1]).toEqual([10]); // custom override, not DEFAULT_RULES.knockout_qf (4)
	});
});
