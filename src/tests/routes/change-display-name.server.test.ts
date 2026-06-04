import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn() }));
vi.mock('$lib/server/rate-limit.js', () => ({ checkAuthRate: vi.fn(() => true) }));
vi.mock('$lib/server/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('$lib/server/cache.js', () => ({ invalidateCachedSessionByUserId: vi.fn() }));

import { POST } from '../../routes/api/auth/change-display-name/+server.js';
import { query } from '$lib/server/db.js';
import { checkAuthRate } from '$lib/server/rate-limit.js';
import { logAudit } from '$lib/server/audit.js';
import { invalidateCachedSessionByUserId } from '$lib/server/cache.js';

const mockQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockRate = checkAuthRate as unknown as ReturnType<typeof vi.fn>;
const mockAudit = logAudit as unknown as ReturnType<typeof vi.fn>;
const mockInval = invalidateCachedSessionByUserId as unknown as ReturnType<typeof vi.fn>;

const req = (body: any) => ({ json: vi.fn().mockResolvedValue(body) });
const locals = (id = 1) => ({ user: { id } });

beforeEach(() => { vi.clearAllMocks(); mockQuery.mockReset(); mockRate.mockReset(); mockRate.mockReturnValue(true); });

describe('POST /api/auth/change-display-name', () => {
  it('401 when not authenticated', async () => {
    const res = await POST({ request: req({ display_name: 'Bob' }), locals: {} as any });
    expect(res.status).toBe(401);
  });

  it('429 when rate-limited', async () => {
    mockRate.mockReturnValue(false);
    const res = await POST({ request: req({ display_name: 'Bob' }), locals: locals() });
    expect(res.status).toBe(429);
  });

  it('400 on empty name', async () => {
    const res = await POST({ request: req({ display_name: '   ' }), locals: locals() });
    expect(res.status).toBe(400);
  });

  it('400 when name exceeds 50 chars', async () => {
    const res = await POST({ request: req({ display_name: 'x'.repeat(51) }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/50/);
  });

  it('400 when new name equals current', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ display_name: 'Bob' }] });
    const res = await POST({ request: req({ display_name: '  Bob  ' }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ya es tu/i);
  });

  it('403 when the 3-change cap is reached', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ display_name: 'Bob' }] }) // current
      .mockResolvedValueOnce({ rows: [{ c: 3 }] });               // used
    const res = await POST({ request: req({ display_name: 'Bobby' }), locals: locals() });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/máximo/i);
  });

  it('200 on success: normalizes, updates, audits, invalidates session', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ display_name: 'Bob' }] }) // current
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })                // used (1 prior)
      .mockResolvedValueOnce({ rows: [] });                       // UPDATE
    const res = await POST({ request: req({ display_name: '  Bob   Smith  ' }), locals: locals(7) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toEqual({ ok: true, display_name: 'Bob Smith', remaining: 1 });

    const update = mockQuery.mock.calls.find((c: any[]) => /UPDATE users SET display_name/i.test(c[0]));
    expect(update![1]).toEqual(['Bob Smith', 7]);
    expect(mockAudit).toHaveBeenCalledWith('change_display_name', 7, 'user', 7, { display_name: 'Bob' }, { display_name: 'Bob Smith' });
    expect(mockInval).toHaveBeenCalledWith(7);
  });
});
