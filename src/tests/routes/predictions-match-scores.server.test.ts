import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks — hoisted above all declarations
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn()
}));

vi.mock('$lib/server/scoring.js', () => ({
	calculateAllScores: vi.fn()
}));

vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedPoolLeaderboard: vi.fn(),
	invalidateCachedPoolResults: vi.fn(),
	invalidateGlobalLeaderboard: vi.fn()
}));

vi.mock('$lib/server/rate-limit.js', () => ({
	checkPredictionRate: vi.fn().mockReturnValue(true)
}));

// Grab references after mock setup
import { query as _mockQuery, getClient as _mockGetClient } from '$lib/server/db.js';
import { calculateAllScores as _mockCalcScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard as _mockInvLeaderboard, invalidateCachedPoolResults as _mockInvResults, invalidateGlobalLeaderboard as _mockInvGlobal } from '$lib/server/cache.js';
import { checkPredictionRate as _mockRateLimit } from '$lib/server/rate-limit.js';

const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = _mockGetClient as unknown as ReturnType<typeof vi.fn>;
const mockCalcScores = _mockCalcScores as unknown as ReturnType<typeof vi.fn>;
const mockInvLeaderboard = _mockInvLeaderboard as unknown as ReturnType<typeof vi.fn>;
const mockInvResults = _mockInvResults as unknown as ReturnType<typeof vi.fn>;
const mockInvGlobal = _mockInvGlobal as unknown as ReturnType<typeof vi.fn>;
const mockRateLimit = _mockRateLimit as unknown as ReturnType<typeof vi.fn>;

import { POST } from '../../routes/api/predictions/match-scores/+server.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/predictions/match-scores', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRateLimit.mockReturnValue(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when not authenticated', async () => {
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: {} }),
			locals: {} as any
		});
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 429 when rate limited', async () => {
		mockRateLimit.mockReturnValue(false);
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: {} }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(429);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 400 when missing prediction_id', async () => {
		const response = await POST({
			request: mockRequest({ scores: { '1': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 400 when too many matches (>200)', async () => {
		const scores: Record<string, { home_score: number; away_score: number }> = {};
		for (let i = 1; i <= 201; i++) {
			scores[String(i)] = { home_score: 1, away_score: 0 };
		}
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 403 when not prediction owner', async () => {
		mockQuery.mockResolvedValueOnce({
			rows: [{ user_id: 999, pool_id: 5 }]
		});
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 403 when not pool member', async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1, pool_id: 5 }]
			})
			.mockResolvedValueOnce({
				rows: []
			});
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('drops started matches and returns 200 with dropped array', async () => {
		// §2.8 — Started matches are silently dropped from the batch instead of
		// rejecting the whole request, so autosave doesn't lose unrelated edits.
		const mockClient = {
			query: vi.fn().mockResolvedValue(undefined),
			release: vi.fn()
		};
		mockGetClient.mockResolvedValueOnce(mockClient);
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1, pool_id: 5 }]
			})
			.mockResolvedValueOnce({
				rows: [{ '?column?': 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ deadline_group: null, deadline_knockout: null }]
			})
			.mockResolvedValueOnce({
				rows: [{ id: 10 }]
			});
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.dropped).toEqual([10]);
	});

	it('#1: the lock query treats a FINISHED match as locked (not just started)', async () => {
		const mockClient = { query: vi.fn().mockResolvedValue(undefined), release: vi.fn() };
		mockGetClient.mockResolvedValueOnce(mockClient);
		mockQuery
			.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] })                       // ownership
			.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })                               // membership
			.mockResolvedValueOnce({ rows: [{ deadline_group: null, deadline_knockout: null }] }) // deadline
			.mockResolvedValueOnce({ rows: [{ id: 10 }] });                                     // match 10 finished → dropped
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(200);
		expect((await response.json()).dropped).toEqual([10]);
		// Critical for #1: fixtures may have NULL kickoff_time, so the guard MUST
		// also lock on status = 'finished' (otherwise a result-known match is editable).
		const guardCall = mockQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('FROM matches') && c[0].includes('ANY($1::int[])')
		);
		expect(guardCall).toBeTruthy();
		expect(guardCall![0]).toContain("status = 'finished'");
	});

	it('returns 403 when group deadline passed', async () => {
		const pastDate = new Date('2020-01-01T00:00:00Z').toISOString();
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1, pool_id: 5 }]
			})
			.mockResolvedValueOnce({
				rows: [{ '?column?': 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ deadline_group: pastDate, deadline_knockout: null }]
			})
			.mockResolvedValueOnce({
				rows: []
			})
			.mockResolvedValueOnce({
				rows: [{ has_group: 1, has_knockout: 0 }]
			});
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 400 when invalid score', async () => {
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1, pool_id: 5 }]
			})
			.mockResolvedValueOnce({
				rows: [{ '?column?': 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ deadline_group: null, deadline_knockout: null }]
			})
			.mockResolvedValueOnce({
				rows: []
			})
			.mockResolvedValueOnce({
				rows: [{ has_group: 0, has_knockout: 0 }]
			});
		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: -1, away_score: 1 } } }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 200 with ok:true on successful save', async () => {
		vi.useFakeTimers();

		const clientQuery = vi.fn()
			.mockResolvedValueOnce({ rows: [] })  // BEGIN
			.mockResolvedValueOnce({ rows: [] })  // INSERT ON CONFLICT for match 10
			.mockResolvedValueOnce({ rows: [] })  // SELECT DISTINCT group_name (match 10 is knockout → none)
			.mockResolvedValueOnce({ rows: [] }); // COMMIT
		const mockRelease = vi.fn();

		const futureDate = new Date('2099-12-31T23:59:59Z').toISOString();
		mockQuery
			.mockResolvedValueOnce({
				rows: [{ user_id: 1, pool_id: 5 }]
			})
			.mockResolvedValueOnce({
				rows: [{ '?column?': 1 }]
			})
			.mockResolvedValueOnce({
				rows: [{ deadline_group: futureDate, deadline_knockout: futureDate }]
			})
			.mockResolvedValueOnce({
				rows: []
			})
			.mockResolvedValueOnce({
				rows: [{ has_group: 1, has_knockout: 0 }]
			});
		mockGetClient.mockResolvedValue({
			query: clientQuery,
			release: mockRelease
		});

		const response = await POST({
			request: mockRequest({
				prediction_id: 1,
				scores: { '10': { home_score: 2, away_score: 1 } }
			}),
			locals: mockLocals(1) as any
		});

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);

		// Verify transaction flow (now includes the in-txn group-standings derivation
		// probe: a SELECT DISTINCT group_name for the touched match ids).
		expect(clientQuery).toHaveBeenCalledTimes(4);
		expect(clientQuery.mock.calls[0][0]).toContain('BEGIN');
		expect(clientQuery.mock.calls[1][0]).toContain('INSERT INTO match_predictions');
		expect(clientQuery.mock.calls[2][0]).toContain('group_name');
		expect(clientQuery.mock.calls[3][0]).toContain('COMMIT');
		expect(mockRelease).toHaveBeenCalled();

		// Advance timers to trigger setImmediate callback
		await vi.runAllTimersAsync();

		// Verify background scoring
		expect(mockCalcScores).toHaveBeenCalledWith(5);
		expect(mockInvLeaderboard).toHaveBeenCalledWith(5);
		expect(mockInvResults).toHaveBeenCalledWith(5);
		expect(mockInvGlobal).toHaveBeenCalled();

		vi.useRealTimers();
	});

	it('derives and upserts group standings from the saved group scorelines', async () => {
		vi.useFakeTimers();

		// Saving a GROUP match score → the endpoint re-reads that entry's saved
		// group scorelines from the DB and upserts the derived table into
		// group_predictions (position_1..4), so the bracket + standings bonus stay
		// in sync without the player ever dragging a table.
		const clientQuery = vi.fn()
			.mockResolvedValueOnce({ rows: [] })                          // BEGIN
			.mockResolvedValueOnce({ rows: [] })                          // INSERT match 10
			.mockResolvedValueOnce({ rows: [{ group_name: 'A' }] })       // DISTINCT affected groups
			.mockResolvedValueOnce({ rows: [                              // saved scorelines for group A
				{ home_team_id: 100, away_team_id: 200, home_score: 2, away_score: 0 },
			] })
			.mockResolvedValueOnce({ rows: [] })                          // upsert group_predictions
			.mockResolvedValueOnce({ rows: [] });                         // COMMIT
		const mockRelease = vi.fn();

		const futureDate = new Date('2099-12-31T23:59:59Z').toISOString();
		mockQuery
			.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] })                         // ownership
			.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })                                 // membership
			.mockResolvedValueOnce({ rows: [{ deadline_group: futureDate, deadline_knockout: futureDate }] }) // deadlines
			.mockResolvedValueOnce({ rows: [] })                                                  // started-match lock (none)
			.mockResolvedValueOnce({ rows: [{ has_group: 1, has_knockout: 0 }] });                // phase deadline check
		mockGetClient.mockResolvedValue({ query: clientQuery, release: mockRelease });

		const response = await POST({
			request: mockRequest({ prediction_id: 1, scores: { '10': { home_score: 2, away_score: 0 } } }),
			locals: mockLocals(1) as any
		});

		expect(response.status).toBe(200);

		// The derived order for a single 2-0 result is [winner, loser] → positions
		// [100, 200, null, null]. Verify that exact upsert was issued.
		const upsert = clientQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO group_predictions')
		);
		expect(upsert).toBeTruthy();
		expect(upsert![1]).toEqual([1, 'A', 100, 200, null, null]);

		await vi.runAllTimersAsync();
		vi.useRealTimers();
	});
});