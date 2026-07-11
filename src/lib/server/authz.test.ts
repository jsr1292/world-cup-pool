import { describe, it, expect } from 'vitest';
import { canManagePool } from './authz.js';

// canManagePool: pool creator OR site admin may manage a pool's admin settings.
// is_admin may arrive as a boolean (from Postgres) or a number (per app.d.ts),
// so the predicate must treat it truthily.

describe('canManagePool', () => {
	it('denies when the pool does not exist', () => {
		expect(canManagePool(null, { id: 1, is_admin: true })).toBe(false);
	});

	it('allows the pool creator', () => {
		expect(canManagePool({ created_by: 7 }, { id: 7, is_admin: false })).toBe(true);
	});

	it('allows a site admin who is not the creator', () => {
		expect(canManagePool({ created_by: 7 }, { id: 99, is_admin: true })).toBe(true);
	});

	it('allows a site admin when is_admin is the number 1 (Postgres/typing quirk)', () => {
		expect(canManagePool({ created_by: 7 }, { id: 99, is_admin: 1 })).toBe(true);
	});

	it('denies a non-creator, non-admin user', () => {
		expect(canManagePool({ created_by: 7 }, { id: 99, is_admin: false })).toBe(false);
	});

	it('denies a non-creator when is_admin is the number 0', () => {
		expect(canManagePool({ created_by: 7 }, { id: 99, is_admin: 0 })).toBe(false);
	});
});
