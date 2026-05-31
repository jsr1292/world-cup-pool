import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/auth/[action]/+server.ts';

// --- Hoisted mocks ---
vi.mock('$lib/server/queries.js', () => ({
	authenticateUser: vi.fn(),
	createUser: vi.fn(),
	createSession: vi.fn(),
	deleteSession: vi.fn(),
}));

import {
	authenticateUser,
	createUser,
	createSession,
	deleteSession,
} from '$lib/server/queries.js';

// --- Helpers ---
const mockCookies = () => ({
	get: vi.fn(),
	set: vi.fn(),
	delete: vi.fn(),
});

const mockParams = (action: string) => ({ action });

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });

const mockEvent = (action: string, body: any, cookies = mockCookies()) => ({
	request: mockRequest(body),
	cookies,
	params: mockParams(action),
	getClientAddress: () => '127.0.0.1',
});

beforeEach(() => {
	vi.clearAllMocks();
	// Reset the in-memory rate limit map by re-importing or using a fresh module.
	// Since _attempts is module-scoped, we use vi.resetModules() + dynamic import when
	// testing rate-limit behaviour specifically. For most tests a single IP is fine.
});

describe('POST /api/auth/[action]', () => {
	// 1. Login success (by email)
	it('login: returns 200 with ok:true on valid credentials', async () => {
		const cookies = mockCookies();
		(authenticateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 42 });
		(createSession as ReturnType<typeof vi.fn>).mockResolvedValue('token-abc');

		const res = await POST(mockEvent('login', { email: 'alice@typsa.es', password: 'pass123' }, cookies));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(authenticateUser).toHaveBeenCalledWith('alice@typsa.es', 'pass123');
		expect(cookies.set).toHaveBeenCalledWith(
			'session', 'token-abc',
			expect.objectContaining({ path: '/', httpOnly: true }),
		);
	});

	// 2. Login wrong password
	it('login: returns 401 on invalid credentials', async () => {
		(authenticateUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		const res = await POST(mockEvent('login', { email: 'alice@typsa.es', password: 'wrong' }));

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/incorrectas/i);
	});

	// 3. Login missing fields
	it('login: returns 400 when email or password is missing', async () => {
		const res = await POST(mockEvent('login', { email: '', password: '' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});

	// 4. Register success (email + display name)
	it('register: returns 200 with ok:true on valid registration', async () => {
		const cookies = mockCookies();
		(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: 7 }] });
		(createSession as ReturnType<typeof vi.fn>).mockResolvedValue('token-reg');

		const res = await POST(mockEvent('register', { email: 'bob@typsa.es', password: 'secret123', display_name: 'Bob' }, cookies));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(createUser).toHaveBeenCalledWith('bob@typsa.es', 'secret123', 'Bob');
		expect(cookies.set).toHaveBeenCalledWith(
			'session', 'token-reg',
			expect.objectContaining({ path: '/', httpOnly: true }),
		);
	});

	// 5. Register duplicate email
	it('register: returns 409 when the email is already registered', async () => {
		const err: any = new Error('Email already registered');
		err.code = 'EMAIL_TAKEN';
		(createUser as ReturnType<typeof vi.fn>).mockRejectedValue(err);

		const res = await POST(mockEvent('register', { email: 'taken@typsa.es', password: 'secret123', display_name: 'X' }));

		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatch(/registrado/i);
	});

	// 6. Register validation — missing fields
	it('register: returns 400 when fields are missing', async () => {
		const res = await POST(mockEvent('register', { email: '', password: '', display_name: '' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/obligatorios/i);
	});

	// 7. Register validation — invalid email format
	it('register: returns 400 on an invalid email', async () => {
		const res = await POST(mockEvent('register', { email: 'not-an-email', password: 'secret123', display_name: 'X' }));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/no válido/i);
		expect(createUser).not.toHaveBeenCalled();
	});

	// 7b. Signup domain restriction (config option)
	it('register: returns 403 when email domain is not allowed', async () => {
		const prev = process.env.ALLOWED_EMAIL_DOMAIN;
		process.env.ALLOWED_EMAIL_DOMAIN = 'typsa.es';
		try {
			const res = await POST(mockEvent('register', { email: 'someone@gmail.com', password: 'secret123', display_name: 'X' }));
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error).toMatch(/@typsa\.es/);
			expect(createUser).not.toHaveBeenCalled();
		} finally {
			if (prev === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
			else process.env.ALLOWED_EMAIL_DOMAIN = prev;
		}
	});

	// 7c. Allowed domain passes
	it('register: allows an email on the configured domain', async () => {
		const prev = process.env.ALLOWED_EMAIL_DOMAIN;
		process.env.ALLOWED_EMAIL_DOMAIN = 'typsa.es';
		(createUser as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [{ id: 9 }] });
		(createSession as ReturnType<typeof vi.fn>).mockResolvedValue('tok');
		try {
			const res = await POST(mockEvent('register', { email: 'ok@typsa.es', password: 'secret123', display_name: 'OK' }));
			expect(res.status).toBe(200);
		} finally {
			if (prev === undefined) delete process.env.ALLOWED_EMAIL_DOMAIN;
			else process.env.ALLOWED_EMAIL_DOMAIN = prev;
		}
	});

	// 8. Logout success
	it('logout: deletes session cookie and redirects to /login', async () => {
		const cookies = mockCookies();
		cookies.get.mockReturnValue('session-token-xyz');

		// redirect() throws a Redirect object — we expect it.
		await expect(
			POST(mockEvent('logout', {}, cookies)),
		).rejects.toThrow();

		expect(deleteSession).toHaveBeenCalledWith('session-token-xyz');
		expect(cookies.delete).toHaveBeenCalledWith('session', { path: '/' });
	});

	// 9. Invalid action param
	it('returns 400 for unknown action', async () => {
		const res = await POST(mockEvent('foobar', {}));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toMatch(/desconocida/i);
	});

	// 10. Rate limiting
	it('returns 429 when rate limit is exceeded', async () => {
		// The module-scoped _attempts map is shared across calls in this test file.
		// We send 10 rapid login requests from the same IP, then the 11th should be rejected.
		const ip = '10.0.0.99';
		const makeEvent = (action: string, body: any) => ({
			request: mockRequest(body),
			cookies: mockCookies(),
			params: mockParams(action),
			getClientAddress: () => ip,
		});

		(authenticateUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);

		// Exhaust the rate limit (10 allowed attempts, but the first sets count=1, so 10 calls total use up the limit)
		for (let i = 0; i < 10; i++) {
			await POST(makeEvent('login', { username: 'user', password: 'pass' }));
		}

		// The 11th should be blocked
		const res = await POST(makeEvent('login', { username: 'user', password: 'pass' }));
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error).toMatch(/15 minutos/i);
	});
});