import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load } from '../../routes/pool/[id]/bracket/+page.server.ts';

vi.mock('$lib/server/queries.js', () => ({
	getPoolById: vi.fn(),
	getUserPredictions: vi.fn(),
	getGroupPredictions: vi.fn().mockResolvedValue([]),
	getAllTeams: vi.fn().mockResolvedValue([]),
	createPrediction: vi.fn(),
	resolveSelectedPrediction: (predictions: any[]) => predictions[0] ?? null,
}));

vi.mock('$lib/server/db.js', () => ({ query: vi.fn(), getClient: vi.fn() }));

import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';

const mockParams = (id: string) => ({ id });
const mockLocals = (userId: number) => ({ user: { id: userId } });
const mockUrl = () => new URL('http://localhost/pool/1/bracket');

describe('bracket page load', () => {
	beforeEach(() => vi.clearAllMocks());

	it('throws 404 when pool not found', async () => {
		(getPoolById as any).mockResolvedValue(null);
		await expect(
			load({ params: mockParams('1'), locals: mockLocals(1) as any, url: mockUrl() } as any),
		).rejects.toMatchObject({ status: 404 });
	});

	it('strips invite_code and share_token from the returned pool', async () => {
		(getPoolById as any).mockResolvedValue({
			id: 1,
			name: 'Quiniela',
			created_by: 1,
			deadline_knockout: null,
			allow_multiple_predictions: false,
			invite_code: 'SECRET_INVITE',
			share_token: 'SECRET_SHARE',
		});
		(query as any)
			.mockResolvedValueOnce({ rows: [{ '1': 1 }] }) // membership gate → is a member
			.mockResolvedValueOnce({ rows: [] }) // bracket_predictions for selected entry
			.mockResolvedValueOnce({ rows: [] }); // per-phase locked rows
		(getUserPredictions as any).mockResolvedValue([{ id: 10, label: 'Principal', total_score: 0 }]);

		const result: any = await load({
			params: mockParams('1'),
			locals: mockLocals(1) as any,
			url: mockUrl(),
		} as any);

		expect(result.pool).not.toHaveProperty('invite_code');
		expect(result.pool).not.toHaveProperty('share_token');
		expect(result.pool.id).toBe(1);
		expect(result.pool.created_by).toBe(1);
	});
});
