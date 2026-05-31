import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db.js', () => ({ query: vi.fn() }));
import { query as _q } from './db.js';
import { buildPredictionSummary } from './prediction-summary.js';
const q = _q as unknown as ReturnType<typeof vi.fn>;

describe('buildPredictionSummary', () => {
  beforeEach(() => q.mockReset());

  it('returns null when the prediction does not exist', async () => {
    q.mockResolvedValueOnce({ rows: [] }); // meta select → none
    expect(await buildPredictionSummary(1)).toBeNull();
  });

  it('assembles groups (dropping empty slots) and orders bracket phases', async () => {
    // Builder queries in order: meta, teams, group_predictions, bracket_predictions.
    q.mockResolvedValueOnce({ rows: [{ id: 7, label: '', pool_name: 'Amigos', display_name: 'Ana', email: 'ana@x.com' }] })
      .mockResolvedValueOnce({ rows: [
        { id: 1, name: 'Mexico', flag_code: 'MX' },
        { id: 2, name: 'Spain', flag_code: 'ES' },
        { id: 3, name: 'Brazil', flag_code: 'BR' },
      ] })
      .mockResolvedValueOnce({ rows: [{ group_name: 'A', position_1: 1, position_2: 2, position_3: null, position_4: null }] })
      .mockResolvedValueOnce({ rows: [{ phase: 'final', team_id: 2 }, { phase: 'r32', team_id: 3 }] });

    const s = await buildPredictionSummary(7);
    expect(s).not.toBeNull();
    expect(s!.label).toBe('Entrada principal'); // empty label → friendly default
    expect(s!.email).toBe('ana@x.com');
    expect(s!.groups).toHaveLength(1);
    expect(s!.groups[0].teams.map(t => t.name)).toEqual(['Mexico', 'Spain']); // null slots dropped
    // bracket ordered r32 before final regardless of insert order
    expect(s!.bracket.map(b => b.phase)).toEqual(['r32', 'final']);
    expect(s!.bracket[0].phaseLabel).toBe('Dieciseisavos');
    expect(s!.bracket[1].teams[0].name).toBe('Spain');
  });
});
