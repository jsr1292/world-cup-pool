import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));
vi.mock('$lib/server/scoring.js', () => ({ getScoringRules: vi.fn() }));
vi.mock('$lib/server/audit.js', () => ({ logAudit: vi.fn() }));

import { GET, POST } from '../../routes/api/admin/scoring/+server.js';
import { query } from '$lib/server/db.js';
import { getScoringRules } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockGetScoringRules = getScoringRules as unknown as ReturnType<typeof vi.fn>;
const mockLogAudit = logAudit as unknown as ReturnType<typeof vi.fn>;

const mockRequest = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const mockLocals = (userId: number) => ({ user: { id: userId } });

const URL_BASE = 'http://localhost/api/admin/scoring';

beforeEach(() => {
	vi.clearAllMocks();
});

describe('GET /api/admin/scoring', () => {
	it('returns 401 when not authenticated', async () => {
		const url = new URL(`${URL_BASE}?pool_id=1`);
		const response = await GET({ url, locals: {} as any });
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe('No autorizado');
	});

	it('returns 400 when pool_id is missing', async () => {
		const url = new URL(URL_BASE);
		const response = await GET({ url, locals: mockLocals(1) });
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Falta pool_id');
	});

	it('returns 400 when pool_id is invalid (non-numeric)', async () => {
		const url = new URL(`${URL_BASE}?pool_id=abc`);
		const response = await GET({ url, locals: mockLocals(1) });
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Falta pool_id');
	});

	it('returns 403 when user is not the pool creator', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 42 }] });

		const url = new URL(`${URL_BASE}?pool_id=1`);
		const response = await GET({ url, locals: mockLocals(5) });
		const data = await response.json();

		expect(response.status).toBe(403);
		expect(data.error).toBe('Prohibido');
	});

	it('returns 403 when pool is not found', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [] });

		const url = new URL(`${URL_BASE}?pool_id=999`);
		const response = await GET({ url, locals: mockLocals(1) });
		const data = await response.json();

		expect(response.status).toBe(403);
		expect(data.error).toBe('Prohibido');
	});

	it('returns 200 with scoring rules from getScoringRules', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		const rules = [
			{ rule: 'match_outcome', points: 3 },
			{ rule: 'exact_score', points: 5 },
		];
		mockGetScoringRules.mockResolvedValueOnce(rules);

		const url = new URL(`${URL_BASE}?pool_id=1`);
		const response = await GET({ url, locals: mockLocals(1) });
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data).toEqual(rules);
		expect(mockGetScoringRules).toHaveBeenCalledWith(1);
	});

	it('returns 500 when database throws an error', async () => {
		mockQuery.mockRejectedValueOnce(new Error('DB down'));

		const url = new URL(`${URL_BASE}?pool_id=1`);
		const response = await GET({ url, locals: mockLocals(1) });
		const data = await response.json();

		expect(response.status).toBe(500);
		expect(data.error).toBe('Internal server error');
	});
});

describe('POST /api/admin/scoring', () => {
	it('returns 401 when not authenticated', async () => {
		const response = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: {} as any,
		});
		const data = await response.json();

		expect(response.status).toBe(401);
		expect(data.error).toBe('No autorizado');
	});

	it('returns 400 when pool_id is missing', async () => {
		const response = await POST({
			request: mockRequest({}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Falta pool_id');
	});

	it('returns 403 when user is not the pool creator', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 42 }] });

		const response = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(5),
		});
		const data = await response.json();

		expect(response.status).toBe(403);
		expect(data.error).toBe('Prohibido');
	});

	it('returns 400 when an invalid rule name is provided', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });

		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				rules: { hack_rule: 10 },
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(400);
		expect(data.error).toBe('Regla inválida: hack_rule');
	});

	it('returns 200 and inserts valid rules with ON CONFLICT upsert', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const rules = { match_outcome: 3, exact_score: 5 };
		const response = await POST({
			request: mockRequest({ pool_id: 1, rules }),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		// First call is the SELECT for pool ownership, next calls are INSERT per rule
		expect(mockQuery).toHaveBeenCalledTimes(3);
		expect(mockQuery).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('INSERT INTO scoring_config'),
			[1, 'match_outcome', 3],
		);
		expect(mockQuery).toHaveBeenNthCalledWith(
			3,
			expect.stringContaining('INSERT INTO scoring_config'),
			[1, 'exact_score', 5],
		);
	});

	it('returns 200 and skips rules where points is not a number or negative', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const rules = {
			match_outcome: 3,
			exact_score: -1,
			group_position: 'bad' as any,
			knockout_r16: NaN,
		};
		const response = await POST({
			request: mockRequest({ pool_id: 1, rules }),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		// Only match_outcome should be inserted (SELECT + 1 INSERT)
		expect(mockQuery).toHaveBeenCalledTimes(2);
		expect(mockQuery).toHaveBeenNthCalledWith(
			2,
			expect.stringContaining('INSERT INTO scoring_config'),
			[1, 'match_outcome', 3],
		);
	});

	it('returns 200 and updates deadline_group when provided', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				deadline_group: '2026-06-14T00:00:00Z',
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining('deadline_group'),
			expect.arrayContaining(['2026-06-14T00:00:00Z']),
		);
	});

	it('returns 200 and updates deadline_knockout when provided', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				deadline_knockout: '2026-06-28T00:00:00Z',
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		expect(mockQuery).toHaveBeenCalledWith(
			expect.stringContaining('deadline_knockout'),
			expect.arrayContaining(['2026-06-28T00:00:00Z']),
		);
	});

	it('returns 200 and updates both deadlines simultaneously', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				deadline_group: '2026-06-14T00:00:00Z',
				deadline_knockout: '2026-06-28T00:00:00Z',
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		const updateCall = mockQuery.mock.calls.find((c: any[]) =>
			typeof c[0] === 'string' && c[0].includes('UPDATE pools'),
		);
		expect(updateCall).toBeDefined();
		expect(updateCall![0]).toContain('deadline_group');
		expect(updateCall![0]).toContain('deadline_knockout');
	});

	it('returns 200 and sets deadlines to null when empty string provided', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				deadline_group: '',
				deadline_knockout: '',
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		const updateCall = mockQuery.mock.calls.find((c: any[]) =>
			typeof c[0] === 'string' && c[0].includes('UPDATE pools'),
		);
		expect(updateCall).toBeDefined();
		// Empty string is falsy, so it should be converted to null
		expect(updateCall![1]).toContain(null);
	});

	it('returns 200 and calls logAudit with correct params', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [{ created_by: 1 }] });
		mockQuery.mockResolvedValue({ rows: [] });

		const rules = { match_outcome: 3 };
		const response = await POST({
			request: mockRequest({
				pool_id: 1,
				rules,
				deadline_group: '2026-06-14T00:00:00Z',
			}),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(data.ok).toBe(true);

		expect(mockLogAudit).toHaveBeenCalledWith(
			'update_scoring',
			1,
			'pool',
			1,
			null,
			{
				rules,
				deadline_group: '2026-06-14T00:00:00Z',
				deadline_knockout: undefined,
			},
		);
	});

	it('returns 500 on unexpected error', async () => {
		mockQuery.mockRejectedValueOnce(new Error('DB crash'));

		const response = await POST({
			request: mockRequest({ pool_id: 1 }),
			locals: mockLocals(1),
		});
		const data = await response.json();

		expect(response.status).toBe(500);
		expect(data.error).toBe('Internal server error');
	});
});