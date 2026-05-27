import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server.ts';

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
	checkPredictionRate: vi.fn(() => true),
}));

vi.mock('$lib/server/cache.js', () => ({
	getTeamsMapCached: vi.fn().mockResolvedValue({}),
}));

vi.mock('$lib/server/queries.js', () => ({
	getGroupStandings: vi.fn(),
}));

import { query } from '$lib/server/db.js';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });
const mockUrl = (search: string) => ({ searchParams: new URLSearchParams(search) });

describe('GET /api/predictions/tiebreaker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when not authenticated', async () => {
		const res = await GET({
			url: mockUrl('prediction_id=1'),
			locals: {} as any,
		});
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toBe('No autorizado');
	});

	it('returns existing tiebreaker scores', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1 }] })
			.mockResolvedValueOnce({ rows: [{ home_score: 3, away_score: 1 }] });

		const res = await GET({
			url: mockUrl('prediction_id=10'),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ home_score: 3, away_score: 1 });
	});

	it('returns null scores when no tiebreaker found', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1 }] })
			.mockResolvedValueOnce({ rows: [] });

		const res = await GET({
			url: mockUrl('prediction_id=10'),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ home_score: null, away_score: null });
	});
});

describe('POST /api/predictions/tiebreaker', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(checkPredictionRate as any).mockReturnValue(true);
	});

	it('returns 401 when not authenticated', async () => {
		const res = await POST({
			request: mockRequest({}),
			locals: {} as any,
		});
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toBe('No autorizado');
	});

	it('returns 200 on successful upsert with scores', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] })
			.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
			.mockResolvedValueOnce({ rows: [{ deadline_knockout: null }] })
			.mockResolvedValueOnce({ rows: [] });

		const res = await POST({
			request: mockRequest({ prediction_id: 1, home_score: 2, away_score: 1 }),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ ok: true });
		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO tiebreaker'),
			[1, 2, 1]
		);
	});

	it('returns 400 when prediction_id is missing', async () => {
		const res = await POST({
			request: mockRequest({ home_score: 2, away_score: 1 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('Falta prediction_id');
	});

	it('returns 400 when scores are not integers', async () => {
		const res = await POST({
			request: mockRequest({ prediction_id: 1, home_score: 2.5, away_score: 1.5 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('Los goles deben ser números enteros');
	});

	it('returns 403 when prediction not found or not owned', async () => {
		(query as any).mockResolvedValueOnce({ rows: [] });

		const res = await POST({
			request: mockRequest({ prediction_id: 1, home_score: 2, away_score: 1 }),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toBe('No es tu predicción');
	});

	it('deletes tiebreaker when scores are null', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] })
			.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
			.mockResolvedValueOnce({ rows: [{ deadline_knockout: null }] })
			.mockResolvedValueOnce({ rows: [] });

		const res = await POST({
			request: mockRequest({ prediction_id: 1, home_score: null, away_score: null }),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ ok: true });
		expect(query).toHaveBeenCalledWith(
			'DELETE FROM tiebreaker WHERE prediction_id = $1',
			[1]
		);
	});

	it('returns 403 when deadline has passed', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] })
			.mockResolvedValueOnce({ rows: [{ 1: 1 }] })
			.mockResolvedValueOnce({ rows: [{ deadline_knockout: '2020-01-01T00:00:00Z' }] });

		const res = await POST({
			request: mockRequest({ prediction_id: 1, home_score: 2, away_score: 1 }),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toBe('La fecha límite ha pasado');
	});
});
