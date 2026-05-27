import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/pools/join/+server.ts';

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
}));

vi.mock('$lib/server/queries.js', () => ({
	getPoolByInvite: vi.fn(),
	joinPool: vi.fn(),
}));

vi.mock('$lib/server/cache.js', () => ({
	invalidateCachedSession: vi.fn(),
}));

import { query } from '$lib/server/db.js';
import { getPoolByInvite, joinPool } from '$lib/server/queries.js';

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

describe('POST /api/pools/join', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when not authenticated', async () => {
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: {} as any,
		});
		const data = await res.json();
		expect(res.status).toBe(401);
		expect(data.error).toBe('Inicia sesión');
	});

	it('returns 400 when invite code is missing', async () => {
		const res = await POST({
			request: mockRequest({}),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(400);
		expect(data.error).toBe('Código requerido');
	});

	it('returns 400 when invite code is not a string', async () => {
		const res = await POST({
			request: mockRequest({ code: 12345 }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(400);
		expect(data.error).toBe('Código requerido');
	});

	it('returns 400 when invite code has invalid format (wrong length)', async () => {
		const res = await POST({
			request: mockRequest({ code: 'short' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(400);
		expect(data.error).toBe('Código de invitación inválido');
	});

	it('returns 400 when invite code has invalid characters', async () => {
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMn!' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(400);
		expect(data.error).toBe('Código de invitación inválido');
	});

	it('returns 404 when pool is not found', async () => {
		(getPoolByInvite as any).mockResolvedValueOnce(null);
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(404);
		expect(data.error).toBe('Código de invitación inválido');
	});

	it('returns 403 when pool is inactive', async () => {
		(getPoolByInvite as any).mockResolvedValueOnce({
			id: 5,
			is_active: false,
		});
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(403);
		expect(data.error).toBe('Esta quiniela ya no está activa');
	});

	it('returns 403 when pool has reached maximum members', async () => {
		(getPoolByInvite as any).mockResolvedValueOnce({
			id: 5,
			is_active: true,
		});
		(query as any).mockResolvedValueOnce({ rows: [{ cnt: 200 }] });
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(403);
		expect(data.error).toContain('máximo de 200 participantes');
	});

	it('returns 409 when user is already a member', async () => {
		(getPoolByInvite as any).mockResolvedValueOnce({
			id: 5,
			is_active: true,
		});
		(query as any).mockResolvedValueOnce({ rows: [{ cnt: 10 }] });
		(joinPool as any).mockResolvedValueOnce(false);
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: mockLocals(1),
		});
		const data = await res.json();
		expect(res.status).toBe(409);
		expect(data.error).toBe('Ya estás en esta quiniela');
	});

	it('returns 200 with pool_id on successful join', async () => {
		(getPoolByInvite as any).mockResolvedValueOnce({
			id: 5,
			is_active: true,
		});
		(query as any).mockResolvedValueOnce({ rows: [{ cnt: 10 }] });
		(joinPool as any).mockResolvedValueOnce(true);
		const res = await POST({
			request: mockRequest({ code: 'AbCdEfGhIjKlMnOp' }),
			locals: mockLocals(42),
		});
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data).toEqual({ pool_id: 5 });
		expect(getPoolByInvite).toHaveBeenCalledWith('ABCDEFGHIJKLMNOP');
		expect(joinPool).toHaveBeenCalledWith(5, 42);
	});
});