import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from '../../routes/api/predictions/group/+server.ts';

// --- Mocks ---
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn(),
}));

import { query } from '$lib/server/db.js';

// --- Helpers ---
const mockLocals = (userId: number) => ({ user: { id: userId } });
const mockUrl = (params: Record<string, string> = {}) => {
	const u = new URL('http://localhost/api/predictions/group');
	for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
	return u;
};

beforeEach(() => {
	vi.clearAllMocks();
});

// Writing group standings directly is no longer supported — the table is DERIVED
// from predicted scorelines by the match-scores endpoint. POST is a 410 stub.
describe('POST /api/predictions/group (deprecated)', () => {
	it('returns 401 when not authenticated', async () => {
		const res = await POST({ locals: {} as any } as any);
		expect(res.status).toBe(401);
	});

	it('returns 410 Gone for an authenticated write (no DB write)', async () => {
		const res = await POST({ locals: mockLocals(1) as any } as any);
		expect(res.status).toBe(410);
		const body = await res.json();
		expect(body.error).toMatch(/obsoleto/i);
		// Must never touch the database.
		expect(query).not.toHaveBeenCalled();
	});
});

// GET (read) is still supported.
describe('GET /api/predictions/group', () => {
	it('returns 401 when not authenticated', async () => {
		const res = await GET({ url: mockUrl({ prediction_id: '1' }), locals: {} as any } as any);
		expect(res.status).toBe(401);
	});

	it('returns 400 when prediction_id is missing', async () => {
		const res = await GET({ url: mockUrl(), locals: mockLocals(1) as any } as any);
		expect(res.status).toBe(400);
	});

	it('returns 403 when the prediction is not yours', async () => {
		(query as any).mockResolvedValueOnce({ rows: [{ user_id: 999 }] }); // ownership check
		const res = await GET({ url: mockUrl({ prediction_id: '5' }), locals: mockLocals(1) as any } as any);
		expect(res.status).toBe(403);
	});

	it('returns the derived standings for the owner', async () => {
		(query as any)
			.mockResolvedValueOnce({ rows: [{ user_id: 1 }] }) // ownership check
			.mockResolvedValueOnce({ rows: [
				{ group_name: 'A', position_1: 10, position_2: 20, position_3: 30, position_4: 40 },
			] });
		const res = await GET({ url: mockUrl({ prediction_id: '5' }), locals: mockLocals(1) as any } as any);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.A).toEqual({ pos1: 10, pos2: 20, pos3: 30, pos4: 40 });
	});
});
