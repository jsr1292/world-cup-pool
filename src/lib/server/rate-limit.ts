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

// §2.1 — change-password rate limit, keyed on userId.
// 5 attempts / 15 minutes is enough to thwart brute force without locking out a
// user who genuinely forgot their current password.
const _authLimits = new Map<number, { count: number; resetAt: number }>();
const AUTH_LIMIT = 5;
const AUTH_WINDOW = 15 * 60 * 1000;

export function checkAuthRate(userId: number): boolean {
  const now = Date.now();
  // Piggy-back on the existing eviction cadence to keep the map bounded.
  if (_authLimits.size > 10_000) {
    for (const [k, v] of _authLimits) if (now > v.resetAt) _authLimits.delete(k);
  }
  const e = _authLimits.get(userId);
  if (!e || now > e.resetAt) {
    _authLimits.set(userId, { count: 1, resetAt: now + AUTH_WINDOW });
    return true;
  }
  if (e.count >= AUTH_LIMIT) return false;
  e.count++;
  return true;
}
