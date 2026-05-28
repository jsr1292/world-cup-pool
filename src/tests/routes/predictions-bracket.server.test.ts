import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/predictions/bracket/+server.ts';

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn(),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
	checkPredictionRate: vi.fn(() => true),
}));

vi.mock('$lib/server/cache.js', () => ({
	getTeamsMapCached: vi.fn().mockResolvedValue({
		10: { id: 10, name: 'Team10' },
		20: { id: 20, name: 'Team20' },
		30: { id: 30, name: 'Team30' },
	}),
}));

import { query, getClient } from '$lib/server/db.js';
import { checkPredictionRate } from '$lib/server/rate-limit.js';
import { getTeamsMapCached } from '$lib/server/cache.js';

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

describe('POST /api/predictions/bracket', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(checkPredictionRate as any).mockReturnValue(true);
		(getTeamsMapCached as any).mockResolvedValue({
			10: { id: 10, name: 'Team10' },
			20: { id: 20, name: 'Team20' },
			30: { id: 30, name: 'Team30' },
		});
	});

	it('Returns 401 when not authenticated', async () => {
		const res = await POST({
			request: mockRequest({}),
			locals: {} as any,
		});
		expect(res.status).toBe(401);
	});

	it('Returns 429 when rate limited', async () => {
		(checkPredictionRate as any).mockReturnValueOnce(false);
		const res = await POST({
			request: mockRequest({}),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(429);
	});

	it('Returns 400 when missing prediction_id', async () => {
		const res = await POST({
			request: mockRequest({ picks: { r16: { 1: 10 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
	});

	it('Returns 400 when too many picks (>64)', async () => {
		const slots: Record<number, number> = {};
		for (let i = 1; i <= 65; i++) slots[i] = 10;
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { r32: slots } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
	});

	it('Returns 403 when not prediction owner', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 999, pool_id: 5 }] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { r16: { 1: 10 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
	});

	it('Returns 403 when not pool member', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		(query as any).mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { r16: { 1: 10 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
	});

	it('Returns 403 when knockout deadline passed', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ deadline_knockout: '2020-01-01' }] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { r16: { 1: 10 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
	});

	it('Returns 400 on invalid phase name', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ deadline_knockout: null }] });
		(query as any).mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { invalid_phase: { 1: 10 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
	});

	it('Returns 400 when team not in preceding phase', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ deadline_knockout: null }] });
		(query as any).mockResolvedValueOnce({ rows: [] });
		// §2.6: getPrecedingTeams('r32') for R16 phase — not in body picks
		(query as any).mockResolvedValueOnce({ rows: [{ team_id: 10 }] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, picks: { r16: { 1: 10 }, qf: { 1: 30 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
	});

	it('Returns 200 on successful save', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });
		(query as any).mockResolvedValueOnce({ rows: [{ deadline_knockout: null }] });
		(query as any).mockResolvedValueOnce({ rows: [] });
		// §2.6: getPrecedingTeams('r32') for r16 validation — r32 not in body picks
		(query as any).mockResolvedValueOnce({ rows: [{ team_id: 10 }, { team_id: 20 }] });

		const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const res = await POST({
			request: mockRequest({
				prediction_id: 1,
				picks: { r16: { 1: 10, 2: 20 }, qf: { 1: 10, 2: 20 } },
			}),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual(expect.objectContaining({ ok: true }));

		expect(clientQuery).toHaveBeenCalledWith('BEGIN');
		expect(clientQuery).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO bracket_predictions'),
			[1, 'r16', 1, 10]
		);
		expect(clientQuery).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO bracket_predictions'),
			[1, 'r16', 2, 20]
		);
		expect(clientQuery).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO bracket_predictions'),
			[1, 'qf', 1, 10]
		);
		expect(clientQuery).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO bracket_predictions'),
			[1, 'qf', 2, 20]
		);
		expect(clientQuery).toHaveBeenCalledWith('COMMIT');
		expect(mockRelease).toHaveBeenCalled();
	});
});