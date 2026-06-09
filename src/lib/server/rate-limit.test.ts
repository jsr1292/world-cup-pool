import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkPredictionRate, PRED_LIMIT } from './rate-limit.js';

describe('checkPredictionRate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Advance time past the eviction interval + window so stale module-level
		// state from previous tests gets cleaned up on the first call.
		vi.advanceTimersByTime(600_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows first request for a new user', () => {
		expect(checkPredictionRate(1)).toBe(true);
	});

	it('allows up to PRED_LIMIT requests within the window', () => {
		for (let i = 0; i < PRED_LIMIT - 1; i++) {
			checkPredictionRate(10);
		}
		// PRED_LIMIT-th request should still be allowed
		expect(checkPredictionRate(10)).toBe(true);
	});

	it('blocks request PRED_LIMIT+1 (returns false)', () => {
		for (let i = 0; i < PRED_LIMIT; i++) {
			checkPredictionRate(20);
		}
		// One past the limit should be blocked
		expect(checkPredictionRate(20)).toBe(false);
	});

	it('resets counter after PRED_WINDOW expires', () => {
		const userId = 30;
		// Exhaust the limit
		for (let i = 0; i < PRED_LIMIT; i++) {
			checkPredictionRate(userId);
		}
		expect(checkPredictionRate(userId)).toBe(false);

		// Advance past the 1-minute window
		vi.advanceTimersByTime(60_001);

		// Should be allowed again
		expect(checkPredictionRate(userId)).toBe(true);
	});

	it('gives different users independent limits', () => {
		// Exhaust user A
		for (let i = 0; i < PRED_LIMIT; i++) {
			checkPredictionRate(100);
		}
		expect(checkPredictionRate(100)).toBe(false);

		// User B should still be allowed
		expect(checkPredictionRate(200)).toBe(true);
	});

	it('increments counter correctly across multiple requests', () => {
		const userId = 40;
		// Make 2 requests — both should succeed (well under limit)
		expect(checkPredictionRate(userId)).toBe(true);
		expect(checkPredictionRate(userId)).toBe(true);

		// Now make the rest to reach exactly PRED_LIMIT total
		for (let i = 0; i < PRED_LIMIT - 2; i++) {
			expect(checkPredictionRate(userId)).toBe(true);
		}
		// One past the limit should be blocked
		expect(checkPredictionRate(userId)).toBe(false);
	});

	it('stays blocked until the window expires', () => {
		const userId = 50;
		// Exhaust the limit
		for (let i = 0; i < PRED_LIMIT; i++) {
			checkPredictionRate(userId);
		}
		expect(checkPredictionRate(userId)).toBe(false);

		// Advance 30 seconds — still within the window
		vi.advanceTimersByTime(30_000);
		expect(checkPredictionRate(userId)).toBe(false);

		// Advance the remaining time to cross the window boundary
		vi.advanceTimersByTime(30_001);
		expect(checkPredictionRate(userId)).toBe(true);
	});

	it('eviction cleanup removes expired entries', () => {
		const userId = 60;
		// First call triggers eviction (time was advanced in beforeEach)
		checkPredictionRate(userId);

		// Advance well past the 1-minute window so the entry expires
		vi.advanceTimersByTime(120_000);

		// Advance past the 5-minute eviction threshold so eviction runs again
		vi.advanceTimersByTime(300_001);

		// A new call triggers eviction; the expired entry for userId 60 is gone,
		// so a fresh entry is created — count resets to 1 and the call succeeds.
		expect(checkPredictionRate(userId)).toBe(true);
	});
});
