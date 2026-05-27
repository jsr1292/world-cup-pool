/**
 * In-memory TTL cache for session, teams, and pool results.
 *
 * ⚠️ CONSTRAINT: All state is module-level (per-process).
 * This works for single-server deployment but will NOT work
 * with horizontal scaling (Vercel serverless, Railway replicas, etc.)
 * — each instance has an isolated cache. After a score sync,
 * only the instance that handled the request invalidates its cache.
 * Other instances serve stale data until TTL expires.
 * If horizontal scaling is needed, migrate to Redis.
 */

import { query } from './db.js';

// ─── Teams ─────────────────────────────────────────────────────────────────
// Teams are static during a tournament. Load once per process.
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
let _globalLeaderboard: TTLEntry<any[]> | null = null;
const GLOBAL_LB_TTL = 30_000; // 30 seconds

export function getCachedGlobalLeaderboard(): any[] | null {
	if (_globalLeaderboard && Date.now() < _globalLeaderboard.expiresAt) {
		return _globalLeaderboard.data;
	}
	_globalLeaderboard = null;
	return null;
}

export function setCachedGlobalLeaderboard(data: any[]): void {
	_globalLeaderboard = { data, expiresAt: Date.now() + GLOBAL_LB_TTL };
}

export function invalidateGlobalLeaderboard(): void {
	_globalLeaderboard = null;
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
