import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
vi.mock('./email.js', () => ({ isEmailConfigured: vi.fn(() => true), sendPredictionSummaryEmail: vi.fn() }));
vi.mock('./prediction-summary.js', () => ({ buildPredictionSummary: vi.fn() }));

import { query as _q } from './db.js';
import { isEmailConfigured as _isCfg, sendPredictionSummaryEmail as _send } from './email.js';
import { buildPredictionSummary as _build } from './prediction-summary.js';
import { notifyLockedPredictions } from './notifications.js';

const q = _q as unknown as ReturnType<typeof vi.fn>;
const isCfg = _isCfg as unknown as ReturnType<typeof vi.fn>;
const send = _send as unknown as ReturnType<typeof vi.fn>;
const build = _build as unknown as ReturnType<typeof vi.fn>;

const updateCalls = () => q.mock.calls.filter(c => String(c[0]).includes('UPDATE predictions SET summary_emailed_at'));

describe('notifyLockedPredictions', () => {
  beforeEach(() => {
    q.mockReset(); send.mockReset(); build.mockReset();
    isCfg.mockReturnValue(true);
    q.mockImplementation((sql: string) => {
      if (sql.includes('summary_emailed_at IS NULL')) {
        return Promise.resolve({ rows: [{ id: 10, email: 'a@x.com' }, { id: 11, email: 'b@x.com' }] });
      }
      return Promise.resolve({ rows: [] }); // UPDATE
    });
    build.mockImplementation((id: number) => Promise.resolve({ predictionId: id, email: id === 10 ? 'a@x.com' : 'b@x.com', poolName: 'P', label: 'x', displayName: 'D', groups: [], bracket: [] }));
    send.mockResolvedValue(undefined);
  });

  it('does nothing when SMTP is not configured', async () => {
    isCfg.mockReturnValue(false);
    const r = await notifyLockedPredictions();
    expect(r).toEqual({ sent: 0, failed: 0 });
    expect(q).not.toHaveBeenCalled();
  });

  it('emails each locked prediction once and marks it sent', async () => {
    const r = await notifyLockedPredictions();
    expect(r).toEqual({ sent: 2, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('a@x.com', expect.any(Object), { locked: true });
    expect(updateCalls()).toHaveLength(2); // both marked
  });

  it('does not mark as sent when the email send fails (retries next tick)', async () => {
    send.mockRejectedValueOnce(new Error('smtp down')); // first send fails
    const r = await notifyLockedPredictions();
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(updateCalls()).toHaveLength(1); // only the successful one marked
  });
});
