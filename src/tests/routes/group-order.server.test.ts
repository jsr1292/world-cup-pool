import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn() }));
vi.mock('$lib/server/rate-limit.js', () => ({ checkPredictionRate: vi.fn(() => true) }));

import { POST } from '../../routes/api/predictions/group-order/+server.js';
import { query } from '$lib/server/db.js';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockRate = checkPredictionRate as unknown as ReturnType<typeof vi.fn>;
const req = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const locals = (id = 1) => ({ user: { id } });

beforeEach(() => { vi.clearAllMocks(); mockQuery.mockReset(); mockRate.mockReset(); mockRate.mockReturnValue(true); });

// Helper: queue the common ownership→membership→deadline→teams→points lead-in.
function leadIn(opts: { ownerId?: number; teams?: number[]; points?: Record<number, number> } = {}) {
  const ownerId = opts.ownerId ?? 1;
  const teams = opts.teams ?? [10, 20, 30, 40];
  mockQuery.mockResolvedValueOnce({ rows: [{ user_id: ownerId, pool_id: 5 }] }); // predictions
  mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }] });                          // membership
  mockQuery.mockResolvedValueOnce({ rows: [{ deadline_group: null }] });          // pool deadline
  mockQuery.mockResolvedValueOnce({ rows: teams.map((t) => ({ tid: t })) });      // group teams
  // match_predictions → synthesize one scoreline per "win" so points come out right
  const pts = opts.points ?? {};
  const gms = Object.entries(pts).flatMap(([id, p]) =>
    Array.from({ length: (p as number) / 3 | 0 }, () => ({ home_team_id: Number(id), away_team_id: 999, home_score: 1, away_score: 0 })));
  mockQuery.mockResolvedValueOnce({ rows: gms });                                 // gms for points
}

describe('POST /api/predictions/group-order', () => {
  it('401 when not authenticated', async () => {
    const res = await POST({ request: req({ prediction_id: 1, group_name: 'A', order: [10, 20] }), locals: {} as any });
    expect(res.status).toBe(401);
  });

  it('400 on incomplete body', async () => {
    const res = await POST({ request: req({ prediction_id: 1 }), locals: locals() });
    expect(res.status).toBe(400);
  });

  it('403 when the prediction is not yours', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 999, pool_id: 5 }] });
    const res = await POST({ request: req({ prediction_id: 1, group_name: 'A', order: [10, 20, 30, 40] }), locals: locals(1) });
    expect(res.status).toBe(403);
  });

  it('400 when order is not a permutation of the group teams', async () => {
    leadIn({ teams: [10, 20, 30, 40] });
    const res = await POST({ request: req({ prediction_id: 1, group_name: 'A', order: [10, 20, 30] }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/todos los equipos/i);
  });

  it('400 when placing a team above one with MORE points', async () => {
    // 20 has 3 pts, others 0. Asking for [10,20,...] puts 10 (0) above 20 (3).
    leadIn({ teams: [10, 20, 30, 40], points: { 20: 3 } });
    const res = await POST({ request: req({ prediction_id: 1, group_name: 'A', order: [10, 20, 30, 40] }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/más puntos/i);
  });

  it('200 and writes the order when it respects points', async () => {
    // All level on points → any order is valid.
    leadIn({ teams: [10, 20, 30, 40], points: {} });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // the INSERT/upsert
    const res = await POST({ request: req({ prediction_id: 1, group_name: 'A', order: [40, 10, 20, 30] }), locals: locals() });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const upsert = mockQuery.mock.calls.find((c: any[]) => /INSERT INTO group_predictions/i.test(c[0]));
    expect(upsert![1]).toEqual([1, 'A', 40, 10, 20, 30]);
  });
});
