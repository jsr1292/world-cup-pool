import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db.js', () => ({ query: vi.fn() }));
vi.mock('$lib/server/rate-limit.js', () => ({ checkAuthRate: vi.fn(() => true) }));
vi.mock('$lib/server/audit.js', () => ({ logAudit: vi.fn() }));
vi.mock('$lib/server/cache.js', () => ({ invalidateCachedSessionByUserId: vi.fn() }));

import { POST } from '../../routes/api/auth/change-username/+server.js';
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

beforeEach(() => {
  vi.clearAllMocks();
  mockRate.mockReturnValue(true);
  delete process.env.ADMIN_USERNAME;
});

describe('POST /api/auth/change-username', () => {
  it('401 when not authenticated', async () => {
    const res = await POST({ request: req({ username: 'newname' }), locals: {} as any });
    expect(res.status).toBe(401);
  });

  it('429 when rate-limited', async () => {
    mockRate.mockReturnValue(false);
    const res = await POST({ request: req({ username: 'newname' }), locals: locals() });
    expect(res.status).toBe(429);
  });

  it('400 on invalid format (too short / bad chars)', async () => {
    const res = await POST({ request: req({ username: 'ab' }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/3.20/);
  });

  it('400 when new = current username', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'alice' }] }); // current
    const res = await POST({ request: req({ username: 'Alice' }), locals: locals() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/ya es tu/i);
  });

  it('409 when taking the configured ADMIN_USERNAME handle', async () => {
    process.env.ADMIN_USERNAME = 'bigboss';
    mockQuery.mockResolvedValueOnce({ rows: [{ username: 'alice' }] }); // current
    const res = await POST({ request: req({ username: 'BigBoss' }), locals: locals() });
    expect(res.status).toBe(409);
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it('403 when the 3-change cap is reached', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] })  // current
      .mockResolvedValueOnce({ rows: [{ c: 3 }] });              // usernameChangesUsed
    const res = await POST({ request: req({ username: 'newname' }), locals: locals() });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/máximo/i);
  });

  it('409 when the username is already taken', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // current
      .mockResolvedValueOnce({ rows: [{ c: 0 }] })              // used
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });    // taken
    const res = await POST({ request: req({ username: 'taken_one' }), locals: locals() });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/en uso/i);
  });

  it('200 on success: updates, audits, invalidates session, returns remaining', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ username: 'alice' }] }) // current
      .mockResolvedValueOnce({ rows: [{ c: 1 }] })              // used (1 prior change)
      .mockResolvedValueOnce({ rows: [] })                      // not taken
      .mockResolvedValueOnce({ rows: [] });                     // UPDATE
    const res = await POST({ request: req({ username: 'Alice_2' }), locals: locals(7) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toEqual({ ok: true, username: 'alice_2', remaining: 1 });

    // UPDATE ran with the normalized (lowercased) handle
    const updateCall = mockQuery.mock.calls.find((c: any[]) => /UPDATE users SET username/i.test(c[0]));
    expect(updateCall[1]).toEqual(['alice_2', 7]);
    expect(mockAudit).toHaveBeenCalledWith('change_username', 7, 'user', 7, { username: 'alice' }, { username: 'alice_2' });
    expect(mockInval).toHaveBeenCalledWith(7);
  });
});
