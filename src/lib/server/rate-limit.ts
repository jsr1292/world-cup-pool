/**
 * In-process rate limiter for prediction save endpoints.
 * Limits each authenticated user to PRED_LIMIT saves per PRED_WINDOW ms.
 *
 * Note: Process-local (not shared across instances). Acceptable trade-off for
 * this use case — the primary goal is preventing accidental runaway autosave
 * bursts from a single browser session, not adversarial multi-instance abuse.
 */

const _predLimits = new Map<number, { count: number; resetAt: number }>();

const PRED_LIMIT = 30;          // max saves per window
const PRED_WINDOW = 60_000;     // 1-minute rolling window

// Evict expired entries to prevent unbounded growth
function _evictExpired(): void {
	const now = Date.now();
	for (const [userId, entry] of _predLimits) {
		if (now > entry.resetAt) _predLimits.delete(userId);
	}
}

// Evict every 5 minutes (runs on first call after 5 min elapsed)
let _lastEvict = 0;

/**
 * Returns true if the user is within rate limit; false if they should receive 429.
 * Increments the counter on every call.
 */
export function checkPredictionRate(userId: number): boolean {
	const now = Date.now();

	// Periodic eviction — O(n) but infrequent
	if (now - _lastEvict > 300_000) {
		_evictExpired();
		_lastEvict = now;
	}

	const entry = _predLimits.get(userId);
	if (!entry || now > entry.resetAt) {
		_predLimits.set(userId, { count: 1, resetAt: now + PRED_WINDOW });
		return true;
	}
	if (entry.count >= PRED_LIMIT) return false;
	entry.count++;
	return true;
}
