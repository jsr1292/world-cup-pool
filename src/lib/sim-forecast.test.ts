import { describe, it, expect } from 'vitest';
import { buildForecastSim } from './sim-forecast.js';

describe('buildForecastSim', () => {
  it('fills only the pending group matches from the member’s group picks', () => {
    const member = {
      groupPicks: { 10: '1' as const, 11: 'X' as const, 12: '2' as const },
      bracketPicks: [],
    };
    const { sim } = buildForecastSim(member, { unplayedGroupMatchIds: [10, 12] }); // 11 already played
    expect(sim).toEqual({ 10: '1', 12: '2' });
  });
});
