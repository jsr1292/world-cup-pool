import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedPoolLeaderboard: vi.fn(),
	invalidateCachedPoolResults: vi.fn(),
	invalidateGlobalLeaderboard: vi.fn(),
}));
vi.mock('$lib/server/scoring.js', () => ({ calculateAllScores: vi.fn() }));

import { POST } from '../../routes/api/predictions/entry/copy/+server.js';
import { query, getClient } from '$lib/server/db.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = getClient as unknown as ReturnType<typeof vi.fn>;

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

// Fake pooled client that records every statement.
function fakeClient() {
	const calls: any[] = [];
	return {
		client: {
			query: vi.fn(async (sql: string, params?: any[]) => { calls.push([sql, params]); return { rows: [], rowCount: 0 }; }),
			release: vi.fn(),
		},
		calls,
	};
}

beforeEach(() => vi.clearAllMocks());

// Standard happy-path priming: predictions (both owned, same pool) → membership
// → pool deadlines (both open) → [client work] → finished-match check (none).
function primeOwnedSamePool(deadlines: { deadline_group: any; deadline_knockout: any }) {
	mockQuery
		.mockResolvedValueOnce({ rows: [
			{ id: 10, user_id: 1, pool_id: 5 },
			{ id: 20, user_id: 1, pool_id: 5 },
		] })
		.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })   // membership
		.mockResolvedValueOnce({ rows: [deadlines] })            // pool deadlines
		.mockResolvedValueOnce({ rows: [] });                    // finished-match check (none)
}

describe('POST /api/predictions/entry/copy', () => {
	it('401 when not authenticated', async () => {
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: {} as any });
		expect(res.status).toBe(401);
	});

	it('400 when source or target missing', async () => {
		const res = await POST({ request: mockRequest({ source_id: 10 }), locals: mockLocals(1) });
		expect(res.status).toBe(400);
	});

	it('400 when copying an entry onto itself', async () => {
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 10 }), locals: mockLocals(1) });
		expect(res.status).toBe(400);
	});

	it('403 when a prediction is not owned by the caller', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [
			{ id: 10, user_id: 1, pool_id: 5 },
			{ id: 20, user_id: 999, pool_id: 5 }, // someone else's entry
		] });
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(403);
	});

	it('400 when the two entries are in different pools', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [
			{ id: 10, user_id: 1, pool_id: 5 },
			{ id: 20, user_id: 1, pool_id: 6 }, // different pool
		] });
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(400);
	});

	it('404 when an entry does not exist', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 10, user_id: 1, pool_id: 5 }] }); // only source
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(404);
	});

	it('403 when both deadlines have passed', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [
				{ id: 10, user_id: 1, pool_id: 5 },
				{ id: 20, user_id: 1, pool_id: 5 },
			] })
			.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
			.mockResolvedValueOnce({ rows: [{ deadline_group: '2020-01-01', deadline_knockout: '2020-01-02' }] });
		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(403);
	});

	it('copies group + knockout and only ever touches the target (deadlines open)', async () => {
		primeOwnedSamePool({ deadline_group: null, deadline_knockout: null });
		const fc = fakeClient();
		mockGetClient.mockResolvedValue(fc.client);

		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ ok: true, copied: { group: true, knockout: true } });

		const sqls = fc.calls.map(c => c[0]);
		expect(sqls.some(s => /^\s*BEGIN/i.test(s))).toBe(true);
		expect(sqls.some(s => /^\s*COMMIT/i.test(s))).toBe(true);
		// All four source tables copied.
		for (const table of ['match_predictions', 'group_predictions', 'bracket_predictions', 'tiebreaker']) {
			expect(fc.calls.some(([s]) => new RegExp(`DELETE FROM ${table}`, 'i').test(s))).toBe(true);
			expect(fc.calls.some(([s]) => new RegExp(`INSERT INTO ${table}`, 'i').test(s))).toBe(true);
		}
		// EVERY write targets the target id (20). The only place the source id (10)
		// appears is as the SELECT filter param of an INSERT … SELECT, never as a
		// DELETE/INSERT destination — so a copy can never mutate the source entry.
		for (const [sql, params] of fc.calls) {
			if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) continue;
			if (/^\s*DELETE/i.test(sql)) {
				expect(params).toEqual([20]); // delete only ever hits the target
			}
			if (/^\s*INSERT/i.test(sql)) {
				expect(params).toEqual([20, 10]); // insert into target, select from source
			}
		}
	});

	it('copies only the knockout section when the group deadline has passed', async () => {
		primeOwnedSamePool({ deadline_group: '2020-01-01', deadline_knockout: null });
		const fc = fakeClient();
		mockGetClient.mockResolvedValue(fc.client);

		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, copied: { group: false, knockout: true } });

		// Group tables must NOT be touched; knockout tables must be.
		expect(fc.calls.some(([s]) => /match_predictions|group_predictions/i.test(s))).toBe(false);
		expect(fc.calls.some(([s]) => /bracket_predictions/i.test(s))).toBe(true);
		expect(fc.calls.some(([s]) => /tiebreaker/i.test(s))).toBe(true);
	});

	it('copies only the group section when the knockout deadline has passed', async () => {
		primeOwnedSamePool({ deadline_group: null, deadline_knockout: '2020-01-01' });
		const fc = fakeClient();
		mockGetClient.mockResolvedValue(fc.client);

		const res = await POST({ request: mockRequest({ source_id: 10, target_id: 20 }), locals: mockLocals(1) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, copied: { group: true, knockout: false } });

		expect(fc.calls.some(([s]) => /match_predictions|group_predictions/i.test(s))).toBe(true);
		expect(fc.calls.some(([s]) => /bracket_predictions|tiebreaker/i.test(s))).toBe(false);
	});
});
