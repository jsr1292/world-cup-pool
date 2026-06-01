import { describe, it, expect } from 'vitest';
import { GROUP_SCHEDULE } from './seed-matches.js';

// Static integrity checks on the hard-coded 2026 group-stage schedule. These
// guard against typos when the data is edited — a malformed schedule would
// otherwise only surface as silently-missing kickoff times at runtime.
describe('GROUP_SCHEDULE', () => {
	const groups = Object.keys(GROUP_SCHEDULE);

	it('covers all 12 groups with 6 fixtures each (72 total)', () => {
		expect(groups.sort()).toEqual('ABCDEFGHIJKL'.split(''));
		const total = Object.values(GROUP_SCHEDULE).reduce((n, f) => n + f.length, 0);
		expect(total).toBe(72);
		for (const g of groups) expect(GROUP_SCHEDULE[g]).toHaveLength(6);
	});

	it('has exactly 4 teams per group, each appearing in 3 fixtures (round-robin)', () => {
		for (const g of groups) {
			const count: Record<string, number> = {};
			for (const fx of GROUP_SCHEDULE[g]) {
				expect(fx.home).not.toBe(fx.away);
				count[fx.home] = (count[fx.home] ?? 0) + 1;
				count[fx.away] = (count[fx.away] ?? 0) + 1;
			}
			const teams = Object.keys(count);
			expect(teams).toHaveLength(4);
			for (const t of teams) expect(count[t]).toBe(3);
		}
	});

	it('pairs every team with every other team exactly once', () => {
		for (const g of groups) {
			const pairs = new Set<string>();
			for (const fx of GROUP_SCHEDULE[g]) {
				pairs.add([fx.home, fx.away].sort().join(' v '));
			}
			expect(pairs.size).toBe(6); // C(4,2) = 6 unique pairings
		}
	});

	it('uses valid, in-tournament UTC instants (11–28 June 2026)', () => {
		for (const g of groups) {
			for (const fx of GROUP_SCHEDULE[g]) {
				const d = new Date(fx.utc);
				expect(Number.isNaN(d.getTime())).toBe(false);
				expect(fx.utc.endsWith('Z')).toBe(true);
				expect(d >= new Date('2026-06-11T00:00:00Z')).toBe(true);
				expect(d <= new Date('2026-06-29T00:00:00Z')).toBe(true);
			}
		}
	});
});
