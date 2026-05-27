import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/predictions/group/+server.ts';

// --- Mocks ---
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn(),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
	checkPredictionRate: vi.fn(() => true),
}));

import { query, getClient } from '$lib/server/db.js';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

// --- Helpers ---
const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

beforeEach(() => {
	vi.clearAllMocks();
	(checkPredictionRate as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

describe('POST /api/predictions/group', () => {
	// 1. Returns 401 when not authenticated
	it('returns 401 when not authenticated', async () => {
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups: {} }),
			locals: {} as any,
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe('No autorizado');
	});

	// 2. Returns 429 when rate limited
	it('returns 429 when rate limited', async () => {
		(checkPredictionRate as ReturnType<typeof vi.fn>).mockReturnValue(false);
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups: {} }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toMatch(/Demasiadas/);
	});

	// 3. Returns 400 when missing prediction_id
	it('returns 400 when missing prediction_id', async () => {
		const res = await POST({
			request: mockRequest({ groups: { A: { pos1: 1 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/prediction_id/i);
	});

	// 4. Returns 400 when too many groups (>32)
	it('returns 400 when too many groups (>32)', async () => {
		const groups: Record<string, { pos1: number }> = {};
		for (let i = 0; i < 33; i++) {
			groups[`G${i}`] = { pos1: i };
		}
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/grupos/i);
	});

	// 5. Returns 403 when not prediction owner
	it('returns 403 when not prediction owner', async () => {
		(query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			rows: [{ user_id: 99, pool_id: 5 }],
		});
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups: { A: { pos1: 1 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toMatch(/predicci/);
	});

	// 6. Returns 403 when not pool member
	it('returns 403 when not pool member', async () => {
		const mockQuery = query as ReturnType<typeof vi.fn>;
		mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		mockQuery.mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups: { A: { pos1: 1 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toMatch(/miembro/);
	});

	// 7. Returns 403 when group deadline passed
	it('returns 403 when group deadline passed', async () => {
		const mockQuery = query as ReturnType<typeof vi.fn>;
		mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
		mockQuery.mockResolvedValueOnce({
			rows: [{ deadline_group: '2020-01-01T00:00:00Z' }],
		});
		const res = await POST({
			request: mockRequest({ prediction_id: 1, groups: { A: { pos1: 1 } } }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toMatch(/l.mite/);
	});

	// 8. Returns 400 on duplicate team in same group
	it('returns 400 on duplicate team in same group', async () => {
		const mockQuery = query as ReturnType<typeof vi.fn>;
		// ownership
		mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		// membership
		mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
		// deadline — future
		mockQuery.mockResolvedValueOnce({
			rows: [{ deadline_group: '2099-01-01T00:00:00Z' }],
		});
		// started groups — none
		mockQuery.mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({
				prediction_id: 1,
				groups: { A: { pos1: 10, pos2: 20, pos3: 10, pos4: 30 } },
			}),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/Duplicate/i);
	});

	// 9. Filters out started groups but saves the rest
	it('filters out started groups but saves the rest', async () => {
		const mockQuery = query as ReturnType<typeof vi.fn>;
		// ownership
		mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		// membership
		mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
		// deadline — future
		mockQuery.mockResolvedValueOnce({
			rows: [{ deadline_group: '2099-01-01T00:00:00Z' }],
		});
		// started groups — group A has started
		mockQuery.mockResolvedValueOnce({ rows: [{ group_name: 'A' }] });
		// team validation for group B only (A was filtered out)
		mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

		const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
		const mockRelease = vi.fn();
		(getClient as ReturnType<typeof vi.fn>).mockResolvedValue({
			query: clientQuery,
			release: mockRelease,
		});

		const res = await POST({
			request: mockRequest({
				prediction_id: 1,
				groups: {
					A: { pos1: 1, pos2: 2 },
					B: { pos1: 10, pos2: 20 },
				},
			}),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		// Verify team validation was only called for group B (5th query call)
		expect(mockQuery).toHaveBeenNthCalledWith(
			5,
			expect.stringContaining('COUNT'),
			['B', [10, 20]]
		);
		// Verify the upsert in the transaction was only for group B
		// client.query calls: BEGIN, upsert for B, COMMIT
		expect(clientQuery).toHaveBeenCalledTimes(3);
		expect(clientQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
		expect(clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('INSERT INTO group_predictions'), [1, 'B', 10, 20, null, null]);
		expect(clientQuery).toHaveBeenNthCalledWith(3, 'COMMIT');
		expect(mockRelease).toHaveBeenCalled();
	});

	// 10. Returns 200 with partial warning for incomplete groups
	it('returns 200 with partial warning for incomplete groups', async () => {
		const mockQuery = query as ReturnType<typeof vi.fn>;
		// ownership
		mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 1, pool_id: 5 }] });
		// membership
		mockQuery.mockResolvedValueOnce({ rows: [{ '1': 1 }] });
		// deadline — future
		mockQuery.mockResolvedValueOnce({
			rows: [{ deadline_group: '2099-01-01T00:00:00Z' }],
		});
		// started groups — none
		mockQuery.mockResolvedValueOnce({ rows: [] });
		// team validation for group A (only 2 positions: [10, 20])
		mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '2' }] });

		const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
		const mockRelease = vi.fn();
		(getClient as ReturnType<typeof vi.fn>).mockResolvedValue({
			query: clientQuery,
			release: mockRelease,
		});

		const res = await POST({
			request: mockRequest({
				prediction_id: 1,
				groups: { A: { pos1: 10, pos2: 20 } },
			}),
			locals: mockLocals(1),
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.advertencia).toMatch(/A/);
		// Verify upsert saved with nulls for missing positions
		expect(clientQuery).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('INSERT INTO group_predictions'),
			[1, 'A', 10, 20, null, null]
		);
		expect(mockRelease).toHaveBeenCalled();
	});
});