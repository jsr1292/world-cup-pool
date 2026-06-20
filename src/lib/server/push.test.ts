import { describe, it, expect } from 'vitest';
import { isQuietHours } from './push.js';

// Quiet window is 22:30–10:00 Europe/Madrid. June = CEST (UTC+2), so Madrid =
// UTC + 2h. Pass explicit UTC instants and assert against Madrid local time.
describe('isQuietHours (22:30–10:00 Europe/Madrid)', () => {
  const at = (utc: string) => isQuietHours(new Date(utc));
  it('is quiet at the 22:30 start', () => expect(at('2026-06-20T20:30:00Z')).toBe(true));   // 22:30
  it('is awake one minute before', () => expect(at('2026-06-20T20:29:00Z')).toBe(false));    // 22:29
  it('is quiet in the dead of night', () => expect(at('2026-06-20T01:00:00Z')).toBe(true));  // 03:00
  it('is quiet at 09:59', () => expect(at('2026-06-20T07:59:00Z')).toBe(true));              // 09:59
  it('wakes up at 10:00', () => expect(at('2026-06-20T08:00:00Z')).toBe(false));             // 10:00
  it('is awake midday', () => expect(at('2026-06-20T12:00:00Z')).toBe(false));               // 14:00
});
