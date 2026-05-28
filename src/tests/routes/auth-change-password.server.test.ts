import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/auth/change-password/+server.ts';

// --- Hoisted mocks ---
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
}));

vi.mock('$lib/server/queries.js', () => ({
	verifyPwd: vi.fn(),
	hashPwd: vi.fn(),
}));

vi.mock('$lib/server/rate-limit.js', () => ({
	checkAuthRate: vi.fn().mockReturnValue(true),
}));

import { query } from '$lib/server/db.js';
import { verifyPwd, hashPwd } from '$lib/server/queries.js';
import { checkAuthRate } from '$lib/server/rate-limit.js';

// --- Helpers ---
const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number | null) => ({
	user: userId ? { id: userId } : null,
});
const mockCookies = () => ({
	get: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
});

const mockEvent = (body: any, userId: number | null = 1, cookies = mockCookies()) => ({
	request: mockRequest(body),
	locals: mockLocals(userId),
	cookies,
});

beforeEach(() => {
	vi.clearAllMocks();
	(checkAuthRate as any).mockReturnValue(true);
});

describe('POST /api/auth/change-password', () => {
	// 1. Auth required
	it('returns 401 when user is not authenticated', async () => {
		const res = await POST(mockEvent({ current_password: 'old', new_password: 'new123' }, null));

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/inicia sesión/i);
	});

	// 2. Successful password change
	it('returns 200 with ok:true on valid password change', async () => {
		const cookies = mockCookies();
		cookies.get.mockReturnValue('current-session-token');
		(query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ password_hash: 'salt:hash' }] });
		(verifyPwd as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(hashPwd as ReturnType<typeof vi.fn>).mockResolvedValue('newhash');

		const res = await POST(mockEvent({ current_password: 'oldPass', new_password: 'newPass123' }, 5, cookies));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(verifyPwd).toHaveBeenCalledWith('oldPass', 'salt:hash');
		expect(hashPwd).toHaveBeenCalledWith('newPass123');
		// §1.3 — 4 calls now: SELECT hash, UPDATE hash, SELECT other tokens, DELETE sessions
		expect(query).toHaveBeenCalledTimes(4);
		expect(query).toHaveBeenCalledWith('UPDATE users SET password_hash = $1 WHERE id = $2', ['newhash', 5]);
		expect(query).toHaveBeenCalledWith(
			'SELECT token FROM sessions WHERE user_id = $1 AND token != $2',
			[5, 'current-session-token']
		);
		expect(query).toHaveBeenCalledWith('DELETE FROM sessions WHERE user_id = $1 AND token != $2', [5, 'current-session-token']);
	});

	// 3. Wrong current password
	it('returns 401 when current password is incorrect', async () => {
		(query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ password_hash: 'salt:hash' }] });
		(verifyPwd as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		const res = await POST(mockEvent({ current_password: 'wrongPass', new_password: 'newPass123' }));

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/incorrecta/i);
		expect(hashPwd).not.toHaveBeenCalled();
	});

	// 4. Missing fields — both empty
	it('returns 400 when current_password and new_password are missing', async () => {
		const res = await POST(mockEvent({}));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});

	// 5. Missing current_password only
	it('returns 400 when current_password is missing', async () => {
		const res = await POST(mockEvent({ new_password: 'newPass123' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});

	// 6. Missing new_password only
	it('returns 400 when new_password is missing', async () => {
		const res = await POST(mockEvent({ current_password: 'oldPass' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});

	// 7. New password too short
	it('returns 400 when new_password is shorter than 6 characters', async () => {
		const res = await POST(mockEvent({ current_password: 'oldPass', new_password: 'abc' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/al menos 6/i);
	});

	// 8. User not found in DB
	it('returns 401 when user row is not found in database', async () => {
		(query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

		const res = await POST(mockEvent({ current_password: 'oldPass', new_password: 'newPass123' }));

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/incorrecta/i);
		expect(verifyPwd).not.toHaveBeenCalled();
	});

	// 9. Database error returns 500
	it('returns 500 when database query throws', async () => {
		(query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB connection lost'));

		const res = await POST(mockEvent({ current_password: 'oldPass', new_password: 'newPass123' }));

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toMatch(/internal server error/i);
	});

	// 10. Empty strings treated as missing
	it('returns 400 when fields are empty strings', async () => {
		const res = await POST(mockEvent({ current_password: '', new_password: '' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});
});
