/**
 * In-memory TTL cache for session, teams, and pool results.
 *
 * ⚠️ HARD CONSTRAINT: All state is module-level (per-process). This is only
 * safe with a SINGLE Node instance. With multiple replicas a logout/password
 * change/score sync executes on one instance only — every other instance keeps
 * serving stale data (and stale auth!) until its local TTL expires.
 *
 * If you need horizontal scale, migrate session + leaderboard caches to Redis
 * (or Postgres LISTEN/NOTIFY) before bumping replica count above 1.
 */

import { query } from './db.js';

export type PoolResultsCache = {
	teams: unknown;
	matches: unknown;
	groupStandings: unknown;
	phaseResults: unknown;
};

// §1.3 — boot-time assertion: refuse to start if env hints at multi-instance.
// Recognises common platform indicators: Vercel (VERCEL=1), Railway replica
// count, Fly machines, Kubernetes pod replicas. Override with
// ALLOW_MULTI_INSTANCE_CACHE=1 (only after migrating caches to a shared store).
(() => {
  if (process.env.ALLOW_MULTI_INSTANCE_CACHE === '1') return;
  const multiHints: { name: string; value: string | undefined }[] = [
    { name: 'VERCEL', value: process.env.VERCEL },
    { name: 'RAILWAY_REPLICA_COUNT', value: process.env.RAILWAY_REPLICA_COUNT },
    { name: 'FLY_APP_REPLICAS', value: process.env.FLY_APP_REPLICAS },
    { name: 'K8S_REPLICAS', value: process.env.K8S_REPLICAS },
  ];
  for (const h of multiHints) {
    if (h.value && h.value !== '' && h.value !== '0' && h.value !== '1') {
      throw new Error(
        `[cache] Refusing to boot: ${h.name}=${h.value} indicates >1 instance ` +
        `but caches are in-process. Set ALLOW_MULTI_INSTANCE_CACHE=1 only ` +
        `after migrating session/leaderboard caches to Redis (see cache.ts).`
      );
    }
    if (h.name === 'VERCEL' && h.value === '1') {
      // Vercel is serverless by default — every cold start has an empty cache.
      console.warn('[cache] Running on Vercel; per-invocation caches are cold. ' +
                   'Consider migrating to Redis for shared state.');
    }
  }
})();

// ─── Teams ─────────────────────────────────────────────────────────────────
// Teams are static during a tournament. Load once per process.
// If team data changes (re-seed, migration), call invalidateTeamsCache() or restart.
let _teams: any[] | null = null;
let _teamsMap: Record<number, any> | null = null;

export async function getAllTeamsCached(): Promise<any[]> {
	if (!_teams) {
		const result = await query('SELECT * FROM teams ORDER BY group_name, fifa_rank');
		_teams = result.rows as any[];
	}
	return _teams;
}

export async function getTeamsMapCached(): Promise<Record<number, any>> {
	if (!_teamsMap) {
		_teamsMap = {};
		for (const t of await getAllTeamsCached()) _teamsMap[t.id] = t;
	}
	return _teamsMap;
}

export function invalidateTeamsCache(): void {
	_teams = null;
	_teamsMap = null;
}

// ─── Generic TTL entry ─────────────────────────────────────────────────────
interface TTLEntry<T> {
	data: T;
	expiresAt: number;
}

// ─── Global leaderboard (F-17) ─────────────────────────────────────────────
// Keyed by VIEWER user id: the "global" board is scoped to the pools the viewer
// belongs to, so two members of different pools must not share a cached result.
const _globalLeaderboard = new Map<number, TTLEntry<any[]>>();
const GLOBAL_LB_TTL = 30_000; // 30 seconds

export function getCachedGlobalLeaderboard(userId: number): any[] | null {
	const e = _globalLeaderboard.get(userId);
	if (e && Date.now() < e.expiresAt) return e.data;
	if (e) _globalLeaderboard.delete(userId);
	return null;
}

export function setCachedGlobalLeaderboard(userId: number, data: any[]): void {
	// Cheap unbounded-growth guard: clear if it ever gets large.
	if (_globalLeaderboard.size > 5_000) _globalLeaderboard.clear();
	_globalLeaderboard.set(userId, { data, expiresAt: Date.now() + GLOBAL_LB_TTL });
}

export function invalidateGlobalLeaderboard(): void {
	_globalLeaderboard.clear();
}

// ─── Per-pool leaderboard (F-19) ───────────────────────────────────────────
const _poolLeaderboard = new Map<number, TTLEntry<any>>();
const POOL_LB_TTL = 30_000; // 30 seconds

export function getCachedPoolLeaderboard(poolId: number): any | null {
	const e = _poolLeaderboard.get(poolId);
	if (!e) return null;
	if (Date.now() > e.expiresAt) {
		_poolLeaderboard.delete(poolId);
		return null;
	}
	return e.data;
}

export function setCachedPoolLeaderboard(poolId: number, data: any): void {
	_poolLeaderboard.set(poolId, { data, expiresAt: Date.now() + POOL_LB_TTL });
}

export function invalidateCachedPoolLeaderboard(poolId: number): void {
	_poolLeaderboard.delete(poolId);
}

// ─── Per-pool results data (F-20) ──────────────────────────────────────────
const _poolResults = new Map<number, TTLEntry<any>>();
const POOL_RESULTS_TTL = 60_000; // 1 minute

export function getCachedPoolResults(poolId: number): any | null {
	const e = _poolResults.get(poolId);
	if (!e) return null;
	if (Date.now() > e.expiresAt) {
		_poolResults.delete(poolId);
		return null;
	}
	return e.data;
}

export function setCachedPoolResults(poolId: number, data: any): void {
	// §7.2 — Run unconditionally; throwing on a real regression in production
	// is cheap and the only way to catch the misuse before users see leaked data.
	const forbidden = ['userId', 'prediction_id', 'predictions', 'userGroupPreds', 'userBracketPreds'];
	for (const key of forbidden) {
		if (key in (data as Record<string, unknown>)) {
			throw new Error(`[cache] setCachedPoolResults must not contain user-scoped key: ${key}`);
		}
	}
	_poolResults.set(poolId, { data, expiresAt: Date.now() + POOL_RESULTS_TTL });
}

export function invalidateCachedPoolResults(poolId: number): void {
	_poolResults.delete(poolId);
}

// ─── Session cache (F-18) ──────────────────────────────────────────────────
const _sessionCache = new Map<string, TTLEntry<any>>();
const SESSION_TTL = 60_000; // 1 minute
const SESSION_CACHE_MAX = 5_000; // evict oldest entry when cap is reached

export function getCachedSession(token: string): any | null {
	const e = _sessionCache.get(token);
	if (!e) return null;
	if (Date.now() > e.expiresAt) {
		_sessionCache.delete(token);
		return null;
	}
	return e.data;
}

export function setCachedSession(token: string, user: any): void {
	if (_sessionCache.size >= SESSION_CACHE_MAX) {
		// Evict the oldest entry (Map preserves insertion order)
		const firstKey = _sessionCache.keys().next().value;
		if (firstKey !== undefined) _sessionCache.delete(firstKey);
	}
	_sessionCache.set(token, { data: user, expiresAt: Date.now() + SESSION_TTL });
}

export function invalidateCachedSession(token: string): void {
	_sessionCache.delete(token);
}

// §1.1 — Invalidate every cached session row for a single user. Used by the
// reset-password / change-password / promote-demote paths so a privilege
// change (or forced logout) takes effect immediately rather than after the
// 60s TTL expires.
export function invalidateCachedSessionByUserId(userId: number): void {
	for (const [token, e] of _sessionCache) {
		if (e.data?.id === userId) _sessionCache.delete(token);
	}
}

// §6.5 — Surface cache occupancy for /api/health.
export function getCacheStats(): {
	sessions: number;
	poolLeaderboard: number;
	poolResults: number;
	teams: number;
} {
	return {
		sessions: _sessionCache.size,
		poolLeaderboard: _poolLeaderboard.size,
		poolResults: _poolResults.size,
		teams: _teams?.length ?? 0,
	};
}
