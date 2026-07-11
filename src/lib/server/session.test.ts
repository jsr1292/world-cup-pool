import { describe, it, expect, vi, beforeEach } from 'vitest';

// The DB is the boundary here and no scratch DB is available (prod is off-limits),
// so we mock ./db.js and assert on the exact SQL arguments. This pins the security
// invariant: the raw session token is NEVER what gets persisted or queried.
vi.mock('./db.js', () => ({
	query: vi.fn().mockResolvedValue({ rows: [] }),
	getClient: vi.fn()
}));

vi.mock('./cache.js', () => ({
	invalidateCachedSession: vi.fn(),
	getAllTeamsCached: vi.fn()
}));

import { query } from './db.js';
import {
	hashSessionToken,
	createSession,
	deleteSession,
	getSessionUser
} from './queries.js';

const mockedQuery = vi.mocked(query);

beforeEach(() => {
	mockedQuery.mockClear();
	mockedQuery.mockResolvedValue({ rows: [] } as any);
});

describe('hashSessionToken', () => {
	it('returns a 64-char hex SHA-256 digest', () => {
		const h = hashSessionToken('some-raw-token');
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});

	it('is deterministic', () => {
		expect(hashSessionToken('abc')).toBe(hashSessionToken('abc'));
	});

	it('is not the identity (never returns the raw token)', () => {
		expect(hashSessionToken('abc')).not.toBe('abc');
	});

	it('produces different digests for different inputs', () => {
		expect(hashSessionToken('abc')).not.toBe(hashSessionToken('abd'));
	});
});

describe('createSession', () => {
	it('stores the HASH of the token, but returns the RAW token for the cookie', async () => {
		const raw = await createSession(42);

		expect(mockedQuery).toHaveBeenCalledTimes(1);
		const [sql, params] = mockedQuery.mock.calls[0];
		expect(sql).toContain('INSERT INTO sessions');

		const [userId, storedToken] = params as any[];
		expect(userId).toBe(42);
		// The persisted value must be the hash, never the raw token.
		expect(storedToken).toBe(hashSessionToken(raw));
		expect(storedToken).not.toBe(raw);
	});
});

describe('deleteSession', () => {
	it('deletes by the hashed token, not the raw token', async () => {
		const raw = 'raw-cookie-token';
		await deleteSession(raw);

		const [sql, params] = mockedQuery.mock.calls[0];
		expect(sql).toContain('DELETE FROM sessions');
		expect((params as any[])[0]).toBe(hashSessionToken(raw));
	});
});

describe('getSessionUser', () => {
	it('looks up the session by the hashed token and returns the user row', async () => {
		const raw = 'raw-cookie-token';
		mockedQuery.mockResolvedValueOnce({ rows: [{ id: 5, username: 'ana' }] } as any);

		const user = await getSessionUser(raw);

		const [sql, params] = mockedQuery.mock.calls[0];
		expect(sql).toContain('FROM users');
		expect(sql).toContain('sessions');
		expect((params as any[])[0]).toBe(hashSessionToken(raw));
		expect(user).toEqual({ id: 5, username: 'ana' });
	});

	it('returns null when no matching session exists', async () => {
		mockedQuery.mockResolvedValueOnce({ rows: [] } as any);
		expect(await getSessionUser('nope')).toBeNull();
	});
});
