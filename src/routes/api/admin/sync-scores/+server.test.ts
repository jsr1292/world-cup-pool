import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks — hoisted above all declarations
vi.mock('$lib/server/live-scores.js', () => ({
	syncScores: vi.fn()
}));

vi.mock('$lib/server/scoring.js', () => ({
	calculateAllScores: vi.fn()
}));

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn()
}));

vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedPoolLeaderboard: vi.fn(),
	invalidateCachedPoolResults: vi.fn(),
	invalidateGlobalLeaderboard: vi.fn()
}));

// Grab references after mock setup
import { syncScores as _mockSyncScores } from '$lib/server/live-scores.js';
import { calculateAllScores as _mockCalculateAllScores } from '$lib/server/scoring.js';
import { query as _mockQuery } from '$lib/server/db.js';
import {
	invalidateCachedPoolLeaderboard as _mockInvalidatePLB,
	invalidateCachedPoolResults as _mockInvalidatePR,
	invalidateGlobalLeaderboard as _mockInvalidateGL
} from '$lib/server/cache.js';

const mockSyncScores = _mockSyncScores as unknown as ReturnType<typeof vi.fn>;
const mockCalculateAllScores = _mockCalculateAllScores as unknown as ReturnType<typeof vi.fn>;
const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;
const mockInvalidatePLB = _mockInvalidatePLB as unknown as ReturnType<typeof vi.fn>;
const mockInvalidatePR = _mockInvalidatePR as unknown as ReturnType<typeof vi.fn>;
const mockInvalidateGL = _mockInvalidateGL as unknown as ReturnType<typeof vi.fn>;

import { POST } from './+server.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const mockLocals = (userId: number, isAdmin = false) => ({
	user: { id: userId, is_admin: isAdmin }
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/sync-scores', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns 401 when not authenticated', async () => {
		const response = await POST({
			locals: {} as any
		});
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 403 when user is not admin', async () => {
		const response = await POST({
			locals: mockLocals(1, false) as any
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 200 with sync result (updated: 0) — no rescoring triggered', async () => {
		mockSyncScores.mockResolvedValueOnce({ updated: 0, skipped: 5, errors: 0 });

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.updated).toBe(0);
		expect(body.skipped).toBe(5);
		expect(body.errors).toBe(0);

		// No rescoring should happen when updated === 0
		expect(mockCalculateAllScores).not.toHaveBeenCalled();
		expect(mockQuery).not.toHaveBeenCalled();
	});

	it('returns 200 with updates > 0 — triggers setImmediate rescoring', async () => {
		vi.useFakeTimers();
		mockSyncScores.mockResolvedValueOnce({ updated: 3, skipped: 1, errors: 0 });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 10 }] });
		mockCalculateAllScores.mockResolvedValue(undefined);

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.ok).toBe(true);
		expect(body.updated).toBe(3);

		// Before timers run, rescoring should not have been called yet
		expect(mockCalculateAllScores).not.toHaveBeenCalled();

		// Run the setImmediate callback
		await vi.runAllTimersAsync();

		// Now rescoring should have been called for the pool
		expect(mockCalculateAllScores).toHaveBeenCalledWith(10);
		expect(mockInvalidatePLB).toHaveBeenCalledWith(10);
		expect(mockInvalidatePR).toHaveBeenCalledWith(10);
		expect(mockInvalidateGL).toHaveBeenCalled();
	});

	it('returns 200 — response includes ok:true and all sync result fields', async () => {
		vi.useFakeTimers();
		mockSyncScores.mockResolvedValueOnce({ updated: 2, skipped: 3, errors: 1 });
		// Need to mock pool query since updated > 0 triggers rescoring path
		mockQuery.mockResolvedValueOnce({ rows: [] });
		mockCalculateAllScores.mockResolvedValue(undefined);

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ ok: true, updated: 2, skipped: 3, errors: 1 });

		// Run timers to flush any setImmediate callbacks
		await vi.runAllTimersAsync();
	});

	it('returns 500 when syncScores throws', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockSyncScores.mockRejectedValueOnce(new Error('Sync exploded'));

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error).toBeDefined();
		expect(errorSpy).toHaveBeenCalled();
	});

	it('rescores multiple pools when updated > 0', async () => {
		vi.useFakeTimers();
		mockSyncScores.mockResolvedValueOnce({ updated: 1, skipped: 0, errors: 0 });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });
		mockCalculateAllScores.mockResolvedValue(undefined);

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(200);

		await vi.runAllTimersAsync();

		expect(mockCalculateAllScores).toHaveBeenCalledTimes(3);
		expect(mockCalculateAllScores).toHaveBeenCalledWith(1);
		expect(mockCalculateAllScores).toHaveBeenCalledWith(2);
		expect(mockCalculateAllScores).toHaveBeenCalledWith(3);
		expect(mockInvalidatePLB).toHaveBeenCalledTimes(3);
		expect(mockInvalidatePR).toHaveBeenCalledTimes(3);
		expect(mockInvalidateGL).toHaveBeenCalledTimes(1);
	});

	it('rescoring handles error in individual pool (others continue)', async () => {
		vi.useFakeTimers();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockSyncScores.mockResolvedValueOnce({ updated: 1, skipped: 0, errors: 0 });
		mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] });
		// First pool throws, second succeeds
		mockCalculateAllScores
			.mockRejectedValueOnce(new Error('Pool 1 scoring failed'))
			.mockResolvedValueOnce(undefined);

		const response = await POST({
			locals: mockLocals(1, true) as any
		});
		expect(response.status).toBe(200);

		await vi.runAllTimersAsync();

		// Both pools should have been attempted
		expect(mockCalculateAllScores).toHaveBeenCalledTimes(2);
		expect(mockCalculateAllScores).toHaveBeenCalledWith(1);
		expect(mockCalculateAllScores).toHaveBeenCalledWith(2);

		// Second pool cache invalidations should still run
		expect(mockInvalidatePLB).toHaveBeenCalledWith(2);
		expect(mockInvalidatePR).toHaveBeenCalledWith(2);

		// Error was logged for pool 1
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining('1'),
			expect.any(Error)
		);

		// Global leaderboard still invalidated
		expect(mockInvalidateGL).toHaveBeenCalled();
	});
});
