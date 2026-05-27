import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../../routes/api/predictions/entry/+server.ts';

vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn(),
}));

vi.mock('$lib/server/cache.js', () => ({
	getTeamsMapCached: vi.fn(),
}));

import { query, getClient } from '$lib/server/db.js';

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

describe('POST /api/predictions/entry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns 401 when not authenticated', async () => {
		const res = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: {} as any,
		});
		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error).toBe('No autorizado');
	});

	it('returns 400 when pool_id is missing', async () => {
		const res = await POST({
			request: mockRequest({}),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('Falta pool_id');
	});

	it('returns 400 when label exceeds 50 characters', async () => {
		const res = await POST({
			request: mockRequest({ pool_id: 1, label: 'x'.repeat(51) }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('Label debe tener máximo 50 caracteres');
	});

	it('returns 400 when label is not a string', async () => {
		const res = await POST({
			request: mockRequest({ pool_id: 1, label: 123 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe('Label debe tener máximo 50 caracteres');
	});

	it('returns 404 when pool not found', async () => {
		(query as any).mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({ pool_id: 999 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(404);
		const data = await res.json();
		expect(data.error).toBe('Quiniela no encontrada');
	});

	it('returns 403 when user is not a pool member', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: true }],
		});
		(query as any).mockResolvedValueOnce({ rows: [] });
		const res = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toBe('No eres miembro de esta quiniela');
	});

	it('returns 403 when multiple predictions not allowed and one already exists', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: false }],
		});
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

		const clientQuery = vi.fn();
		// existing predictions query returns one row
		clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
		clientQuery.mockResolvedValueOnce({ rows: [{ id: 10, label: '' }] }); // SELECT FOR UPDATE
		clientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const res = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error).toBe('Ya tienes una predicción en esta quiniela');
		expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
		expect(mockRelease).toHaveBeenCalled();
	});

	it('returns 409 when label duplicates an existing prediction', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: true }],
		});
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

		const clientQuery = vi.fn();
		clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
		clientQuery.mockResolvedValueOnce({ rows: [{ id: 10, label: 'My Entry' }] }); // SELECT FOR UPDATE
		clientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const res = await POST({
			request: mockRequest({ pool_id: 1, label: 'My Entry' }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(409);
		const data = await res.json();
		expect(data.error).toBe('Ya existe una entrada con ese nombre');
		expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
		expect(mockRelease).toHaveBeenCalled();
	});

	it('returns 200 on successful entry creation with multiple predictions allowed', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: true }],
		});
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

		const clientQuery = vi.fn();
		clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
		clientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE (no existing)
		clientQuery.mockResolvedValueOnce({ rows: [{ has_paid: true }] }); // member has_paid
		clientQuery.mockResolvedValueOnce({ rows: [{ id: 42 }] }); // INSERT RETURNING
		clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const res = await POST({
			request: mockRequest({ pool_id: 1, label: 'Entry A' }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ id: 42, label: 'Entry A' });

		expect(clientQuery).toHaveBeenCalledWith('BEGIN');
		expect(clientQuery).toHaveBeenCalledWith(
			expect.stringContaining('INSERT INTO predictions'),
			[1, 1, 'Entry A', true]
		);
		expect(clientQuery).toHaveBeenCalledWith('COMMIT');
		expect(mockRelease).toHaveBeenCalled();
	});

	it('returns 200 on first entry when multiple predictions not allowed', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: false }],
		});
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

		const clientQuery = vi.fn();
		clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
		clientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE (no existing)
		clientQuery.mockResolvedValueOnce({ rows: [{ has_paid: false }] }); // member has_paid
		clientQuery.mockResolvedValueOnce({ rows: [{ id: 7 }] }); // INSERT RETURNING
		clientQuery.mockResolvedValueOnce({ rows: [] }); // COMMIT
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const res = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data).toEqual({ id: 7, label: '' });

		expect(clientQuery).toHaveBeenCalledWith('COMMIT');
		expect(mockRelease).toHaveBeenCalled();
	});

	it('returns 500 and rolls back on unexpected error inside transaction', async () => {
		(query as any).mockResolvedValueOnce({
			rows: [{ id: 1, allow_multiple_predictions: true }],
		});
		(query as any).mockResolvedValueOnce({ rows: [{ 1: 1 }] });

		const clientQuery = vi.fn();
		clientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
		clientQuery.mockResolvedValueOnce({ rows: [] }); // SELECT FOR UPDATE
		clientQuery.mockResolvedValueOnce({ rows: [{ has_paid: false }] }); // member has_paid
		clientQuery.mockRejectedValueOnce(new Error('DB insert failed')); // INSERT fails
		clientQuery.mockResolvedValueOnce({ rows: [] }); // ROLLBACK
		const mockRelease = vi.fn();
		(getClient as any).mockResolvedValue({ query: clientQuery, release: mockRelease });

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(1),
		});
		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error).toBe('Internal server error');
		expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
		expect(mockRelease).toHaveBeenCalled();
		consoleSpy.mockRestore();
	});
});