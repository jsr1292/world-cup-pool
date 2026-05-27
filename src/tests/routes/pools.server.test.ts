import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocks — hoisted above all declarations
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn()
}));

vi.mock('$lib/server/queries.js', () => ({
	createPool: vi.fn()
}));

vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedPoolLeaderboard: vi.fn(),
	invalidateCachedPoolResults: vi.fn(),
	invalidateGlobalLeaderboard: vi.fn(),
	invalidateCachedSession: vi.fn(),
	getAllTeamsCached: vi.fn().mockResolvedValue([])
}));

// Grab references after mock setup
import { query as _mockQuery } from '$lib/server/db.js';
import { createPool as _mockCreatePool } from '$lib/server/queries.js';

const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;
const mockCreatePool = _mockCreatePool as unknown as ReturnType<typeof vi.fn>;

import { POST } from '../../routes/api/pools/+server.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

/**
 * Set up query mock so canCreatePools returns true.
 * - First call: site_settings → mode 'anyone' (simplest path)
 */
function allowAnyone() {
	mockQuery.mockResolvedValueOnce({
		rows: [{ value: 'anyone' }]
	});
}

/**
 * Set up query mocks so canCreatePools returns true via admin.
 * - Call 1: site_settings → mode 'admin'
 * - Call 2: users → is_admin true
 */
function allowAdmin() {
	mockQuery
		.mockResolvedValueOnce({ rows: [{ value: 'admin' }] })
		.mockResolvedValueOnce({ rows: [{ is_admin: true }] });
}

/**
 * Set up query mocks so canCreatePools returns false.
 * - Call 1: site_settings → mode 'admin'
 * - Call 2: users → not admin
 * - Call 3: pool_creators → empty
 */
function denyPermission() {
	mockQuery
		.mockResolvedValueOnce({ rows: [{ value: 'admin' }] })
		.mockResolvedValueOnce({ rows: [{ is_admin: false }] })
		.mockResolvedValueOnce({ rows: [] });
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/pools', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns 401 when not authenticated', async () => {
		const response = await POST({
			request: mockRequest({ name: 'Test Pool' }),
			locals: {} as any
		});
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 403 when user lacks pool creation permission', async () => {
		denyPermission();

		const response = await POST({
			request: mockRequest({ name: 'Test Pool' }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(403);
		const body = await response.json();
		expect(body.error).toBeDefined();
	});

	it('returns 400 when name is missing', async () => {
		allowAnyone();

		const response = await POST({
			request: mockRequest({}),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toMatch(/nombre/i);
	});

	it('returns 400 when name is too short (1 character)', async () => {
		allowAnyone();

		const response = await POST({
			request: mockRequest({ name: 'A' }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toMatch(/mínimo 2/i);
	});

	it('returns 400 when name is too long (>100 characters)', async () => {
		allowAnyone();

		const response = await POST({
			request: mockRequest({ name: 'X'.repeat(101) }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toMatch(/100 caracteres/i);
	});

	it('returns 400 when buy_in is negative', async () => {
		allowAnyone();

		const response = await POST({
			request: mockRequest({ name: 'My Pool', buy_in: -5 }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toMatch(/positivo/i);
	});

	it('returns 400 when buy_in is not a valid number', async () => {
		allowAnyone();

		const response = await POST({
			request: mockRequest({ name: 'My Pool', buy_in: 'abc' }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toMatch(/positivo/i);
	});

	it('returns 200 with pool id and invite_code on successful creation (anyone mode)', async () => {
		allowAnyone();
		mockCreatePool.mockResolvedValueOnce({ id: 42, inviteCode: 'ABC123DEF456' });

		const response = await POST({
			request: mockRequest({ name: 'World Cup 2026', buy_in: 10, allow_multiple: true }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.id).toBe(42);
		expect(body.invite_code).toBe('ABC123DEF456');

		expect(mockCreatePool).toHaveBeenCalledWith('World Cup 2026', 1, 10, true);
	});

	it('returns 200 with pool data when admin user creates pool', async () => {
		allowAdmin();
		mockCreatePool.mockResolvedValueOnce({ id: 7, inviteCode: 'XYZ789' });

		const response = await POST({
			request: mockRequest({ name: 'Admin Pool' }),
			locals: mockLocals(5) as any
		});
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.id).toBe(7);
		expect(body.invite_code).toBe('XYZ789');

		// Verify default buy_in (0) and allow_multiple (false) are passed
		expect(mockCreatePool).toHaveBeenCalledWith('Admin Pool', 5, 0, false);
	});

	it('returns 500 when createPool throws an error', async () => {
		allowAnyone();
		mockCreatePool.mockRejectedValueOnce(new Error('DB failure'));

		const response = await POST({
			request: mockRequest({ name: 'Failing Pool' }),
			locals: mockLocals(1) as any
		});
		expect(response.status).toBe(500);
		const body = await response.json();
		expect(body.error).toMatch(/internal/i);
	});
});