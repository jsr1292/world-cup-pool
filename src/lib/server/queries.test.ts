import { describe, it, expect } from 'vitest';
import { hashPwd, verifyPwd, generateInviteCode, generateToken } from './queries.js';

// ── hashPwd + verifyPwd ──────────────────────────────────────────────────

describe('hashPwd + verifyPwd', () => {
	it('hashes a password and verifies it correctly', async () => {
		const hash = await hashPwd('mypassword123');
		expect(hash).toContain(':');
		const [salt, derived] = hash.split(':');
		expect(salt).toHaveLength(32); // 16 bytes → 32 hex chars
		expect(derived).toHaveLength(128); // 64 bytes → 128 hex chars
		await expect(verifyPwd('mypassword123', hash)).resolves.toBe(true);
	});

	it('rejects wrong password', async () => {
		const hash = await hashPwd('correctpassword');
		await expect(verifyPwd('wrongpassword', hash)).resolves.toBe(false);
	});

	it('throws on malformed hash (missing separator)', async () => {
		await expect(verifyPwd('test', 'noColonHere')).rejects.toThrow('Malformed password hash');
	});

	it('throws on malformed hash (empty salt)', async () => {
		await expect(verifyPwd('test', ':somehash')).rejects.toThrow('Malformed password hash');
	});

	it('generates different hashes for same password (unique salt)', async () => {
		const hash1 = await hashPwd('samepassword');
		const hash2 = await hashPwd('samepassword');
		expect(hash1).not.toBe(hash2); // different salts
		await expect(verifyPwd('samepassword', hash1)).resolves.toBe(true);
		await expect(verifyPwd('samepassword', hash2)).resolves.toBe(true);
	});
});

// ── generateInviteCode ───────────────────────────────────────────────────

describe('generateInviteCode', () => {
	it('returns a 24-char uppercase base64url string', () => {
		const code = generateInviteCode();
		expect(code).toHaveLength(24);
		expect(code).toMatch(/^[A-Z0-9_-]+$/);
	});

	it('generates unique codes', () => {
		const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
		expect(codes.size).toBe(20);
	});
});

// ── generateToken ────────────────────────────────────────────────────────

describe('generateToken', () => {
	it('returns a 64-char hex string', () => {
		const token = generateToken();
		expect(token).toHaveLength(64); // 32 bytes → 64 hex chars
		expect(token).toMatch(/^[0-9a-f]+$/);
	});

	it('generates unique tokens', () => {
		const tokens = new Set(Array.from({ length: 20 }, () => generateToken()));
		expect(tokens.size).toBe(20);
	});
});
