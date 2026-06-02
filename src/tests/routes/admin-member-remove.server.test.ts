import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('$lib/server/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedPoolLeaderboard: vi.fn(),
	invalidateGlobalLeaderboard: vi.fn(),
}));

import { POST } from '../../routes/api/admin/member/remove/+server.js';
import { query, getClient } from '$lib/server/db.js';
import { logAudit } from '$lib/server/audit.js';
import {
	invalidateCachedPoolLeaderboard,
	invalidateGlobalLeaderboard,
} from '$lib/server/cache.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = getClient as unknown as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>;
const mockInvalidatePLB = invalidateCachedPoolLeaderboard as unknown as ReturnType<typeof vi.fn>;
const mockInvalidateGL = invalidateGlobalLeaderboard as unknown as ReturnType<typeof vi.fn>;

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number, isAdmin = false) => ({ user: { id: userId, is_admin: isAdmin } });

// A fake pooled client whose DELETE calls are scripted per-test.
function fakeClient(deleteRowCounts: number[]) {
	let del = 0;
	const calls: any[] = [];
	return {
		client: {
			query: vi.fn(async (sql: string, params?: any[]) => {
				calls.push([sql, params]);
				if (/^\s*DELETE/i.test(sql)) {
					return { rowCount: deleteRowCounts[del++] ?? 0, rows: [] };
				}
				return { rows: [], rowCount: 0 };
			}),
			release: vi.fn(),
		},
		calls,
	};
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/member/remove', () => {
	it('401 when not authenticated', async () => {
		const res = await POST({ request: mockRequest({ pool_id: 1, user_id: 2 }), locals: {} as any });
		expect(res.status).toBe(401);
	});

	it('400 when pool_id missing', async () => {
		const res = await POST({ request: mockRequest({ user_id: 2 }), locals: mockLocals(1) });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/pool_id/);
	});

	it('400 when user_id missing', async () => {
		const res = await POST({ request: mockRequest({ pool_id: 1 }), locals: mockLocals(1) });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/user_id/);
	});

	it('403 when caller is neither creator nor site admin', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 99 }] });
		const res = await POST({ request: mockRequest({ pool_id: 1, user_id: 2 }), locals: mockLocals(5) });
		expect(res.status).toBe(403);
	});

	it('400 when trying to remove the pool creator', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 7 }] });
		const res = await POST({ request: mockRequest({ pool_id: 1, user_id: 7 }), locals: mockLocals(7) });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toMatch(/creador/i);
		expect(mockGetClient).not.toHaveBeenCalled();
	});

	it('404 when the target is not a member (no pool_members row deleted)', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		const { client } = fakeClient([0 /*predictions*/, 0 /*pool_members*/]);
		mockGetClient.mockResolvedValueOnce(client);

		const res = await POST({ request: mockRequest({ pool_id: 1, user_id: 2 }), locals: mockLocals(1) });
		expect(res.status).toBe(404);
		// Committed (delete of zero rows is still a valid txn) and released.
		expect(client.query).toHaveBeenCalledWith('COMMIT');
		expect(client.release).toHaveBeenCalled();
		expect(mockInvalidatePLB).not.toHaveBeenCalled();
	});

	it('200 removes member: deletes predictions then membership, invalidates caches, audits', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		const { client, calls } = fakeClient([3 /*predictions*/, 1 /*pool_members*/]);
		mockGetClient.mockResolvedValueOnce(client);

		const res = await POST({ request: mockRequest({ pool_id: 4, user_id: 2 }), locals: mockLocals(1) });
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);

		const sqls = calls.map((c) => c[0]);
		expect(sqls).toContain('BEGIN');
		expect(sqls).toContain('COMMIT');
		// predictions deleted before pool_members
		const predIdx = sqls.findIndex((s: string) => /DELETE FROM predictions/i.test(s));
		const memIdx = sqls.findIndex((s: string) => /DELETE FROM pool_members/i.test(s));
		expect(predIdx).toBeGreaterThanOrEqual(0);
		expect(memIdx).toBeGreaterThan(predIdx);
		// scoped to the right pool + user
		expect(calls[predIdx][1]).toEqual([4, 2]);
		expect(calls[memIdx][1]).toEqual([4, 2]);

		expect(mockInvalidatePLB).toHaveBeenCalledWith(4);
		expect(mockInvalidateGL).toHaveBeenCalled();
		expect(mockLogAudit).toHaveBeenCalledWith('remove_member', 1, 'pool', 4, null, { removed_user_id: 2 });
		expect(client.release).toHaveBeenCalled();
	});

	it('allows a site admin who is not the creator', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 99 }] });
		const { client } = fakeClient([1, 1]);
		mockGetClient.mockResolvedValueOnce(client);

		const res = await POST({ request: mockRequest({ pool_id: 1, user_id: 2 }), locals: mockLocals(5, true) });
		expect(res.status).toBe(200);
	});
});
