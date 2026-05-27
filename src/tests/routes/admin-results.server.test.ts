import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('$lib/server/audit.js', () => ({
	logAudit: vi.fn()
}));

import { query as _mockQuery } from '$lib/server/db.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';
import { logAudit } from '$lib/server/audit.js';

const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

// Import the handler after mocks are set up
import { POST } from '../../routes/api/admin/results/+server.js';

describe('POST /api/admin/results', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 401 when not authenticated', async () => {
		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 1 });
		const locals = {} as any;

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(401);
		expect(body.error).toBe('No autorizado');
	});

	it('returns 400 when match_id is missing', async () => {
		const request = mockRequest({ home_score: 2, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Faltan campos');
	});

	it('returns 400 when home_score is missing', async () => {
		const request = mockRequest({ match_id: 1, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Faltan campos');
	});

	it('returns 400 when away_score is missing', async () => {
		const request = mockRequest({ match_id: 1, home_score: 2 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Faltan campos');
	});

	it('returns 400 when home_score is not an integer', async () => {
		const request = mockRequest({ match_id: 1, home_score: 1.5, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 400 when away_score is not an integer', async () => {
		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 3.7 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 400 when home_score is negative', async () => {
		const request = mockRequest({ match_id: 1, home_score: -1, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 400 when away_score is negative', async () => {
		const request = mockRequest({ match_id: 1, home_score: 2, away_score: -3 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 400 when home_score exceeds 30', async () => {
		const request = mockRequest({ match_id: 1, home_score: 31, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 400 when away_score exceeds 30', async () => {
		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 50 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toBe('Marcador inválido');
	});

	it('returns 403 when user is not an admin', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: false }] });

		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe('Solo los administradores pueden modificar resultados');
	});

	it('returns 403 when user does not exist in db', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 1 });
		const locals = mockLocals(99);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(403);
		expect(body.error).toBe('Solo los administradores pueden modificar resultados');
	});

	it('returns 404 when match is not found', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const request = mockRequest({ match_id: 999, home_score: 2, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body.error).toBe('Partido no encontrado');
	});

	it('returns 200 and calls UPDATE query with correct params', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, home_score: null, away_score: null }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const request = mockRequest({ match_id: 5, home_score: 3, away_score: 2 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.scoring).toBe('pending');

		// Third query call is the UPDATE
		expect(mockQuery).toHaveBeenCalledTimes(4);
		expect(mockQuery).toHaveBeenNthCalledWith(
			3,
			"UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
			[3, 2, 5, null]
		);
	});

	it('returns 200 and calls logAudit with correct params', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, home_score: null, away_score: null }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const request = mockRequest({ match_id: 5, home_score: 3, away_score: 2 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);

		expect(response.status).toBe(200);
		expect(logAudit).toHaveBeenCalledWith(
			'update_result',
			1,
			'match',
			5,
			{ home_score: null, away_score: null },
			{ home_score: 3, away_score: 2 }
		);
	});

	it('passes penalty_winner_id to UPDATE query when provided', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, home_score: 1, away_score: 1 }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const request = mockRequest({ match_id: 10, home_score: 1, away_score: 1, penalty_winner_id: 7 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);

		expect(response.status).toBe(200);
		expect(mockQuery).toHaveBeenCalledWith(
			"UPDATE matches SET home_score = $1, away_score = $2, status = 'finished', penalty_winner_id = $4 WHERE id = $3",
			[1, 1, 10, 7]
		);
	});

	it('triggers calculateAllScores and cache invalidation via setImmediate for each active pool', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, home_score: 0, away_score: 0 }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 100 }, { id: 200 }] });

		(calculateAllScores as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
		(invalidateCachedPoolLeaderboard as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(invalidateCachedPoolResults as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
		(invalidateGlobalLeaderboard as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

		const request = mockRequest({ match_id: 3, home_score: 2, away_score: 0 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		expect(response.status).toBe(200);

		// Before timers run, background scoring should not have executed yet
		expect(calculateAllScores).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();

		// calculateAllScores called for each active pool
		expect(calculateAllScores).toHaveBeenCalledTimes(2);
		expect(calculateAllScores).toHaveBeenCalledWith(100);
		expect(calculateAllScores).toHaveBeenCalledWith(200);

		// Cache invalidation per pool
		expect(invalidateCachedPoolLeaderboard).toHaveBeenCalledTimes(2);
		expect(invalidateCachedPoolLeaderboard).toHaveBeenCalledWith(100);
		expect(invalidateCachedPoolLeaderboard).toHaveBeenCalledWith(200);

		expect(invalidateCachedPoolResults).toHaveBeenCalledTimes(2);
		expect(invalidateCachedPoolResults).toHaveBeenCalledWith(100);
		expect(invalidateCachedPoolResults).toHaveBeenCalledWith(200);

		// Global leaderboard invalidated once after all pools
		expect(invalidateGlobalLeaderboard).toHaveBeenCalledTimes(1);
	});

	it('returns 500 on unexpected error', async () => {
		mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

		const request = mockRequest({ match_id: 1, home_score: 2, away_score: 1 });
		const locals = mockLocals(1);

		const response = await POST({ request, locals } as any);
		const body = await response.json();

		expect(response.status).toBe(500);
		expect(body.error).toBe('Internal server error');
	});
});