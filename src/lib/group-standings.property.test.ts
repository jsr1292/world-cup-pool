import { describe, it, expect } from 'vitest';
import { rankGroup, type GsMatch } from './group-standings.js';

// Property-based checks: thousands of randomized groups, asserting invariants
// that must hold for EVERY input — a complement to the example-based tests in
// group-standings.test.ts. Seeded PRNG so failures are reproducible: on a
// failure, the assertion message carries the case's seed.

function mulberry32(seed: number) {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Random group: 4 teams, a random subset of the 6 fixtures, random scores. */
function randomCase(rnd: () => number) {
	const teams = [1, 2, 3, 4].map((n) => n + Math.floor(rnd() * 50) * 10); // ids vary
	const fixtures: Array<[number, number]> = [];
	for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) fixtures.push([teams[i], teams[j]]);
	const played = fixtures.filter(() => rnd() < 0.8); // sometimes partial groups
	const matches: GsMatch[] = played.map(([h, a]) => ({
		homeTeamId: h,
		awayTeamId: a,
		homeScore: Math.floor(rnd() * 5),
		awayScore: Math.floor(rnd() * 5),
	}));
	return { teams, matches };
}

function pointsTable(matches: GsMatch[]): Map<number, number> {
	const pts = new Map<number, number>();
	const add = (id: number, n: number) => pts.set(id, (pts.get(id) ?? 0) + n);
	for (const m of matches) {
		add(m.homeTeamId, 0); add(m.awayTeamId, 0);
		if (m.homeScore > m.awayScore) add(m.homeTeamId, 3);
		else if (m.homeScore < m.awayScore) add(m.awayTeamId, 3);
		else { add(m.homeTeamId, 1); add(m.awayTeamId, 1); }
	}
	return pts;
}

function gdGf(matches: GsMatch[]): Map<number, { gd: number; gf: number }> {
	const t = new Map<number, { gd: number; gf: number }>();
	const get = (id: number) => { if (!t.has(id)) t.set(id, { gd: 0, gf: 0 }); return t.get(id)!; };
	for (const m of matches) {
		const h = get(m.homeTeamId), a = get(m.awayTeamId);
		h.gf += m.homeScore; h.gd += m.homeScore - m.awayScore;
		a.gf += m.awayScore; a.gd += m.awayScore - m.homeScore;
	}
	return t;
}

const CASES = 3000;

describe('rankGroup properties (seeded random)', () => {
	it('always returns a permutation of the teams that played', () => {
		for (let seed = 1; seed <= CASES; seed++) {
			const { matches } = randomCase(mulberry32(seed));
			const ids = new Set<number>();
			for (const m of matches) { ids.add(m.homeTeamId); ids.add(m.awayTeamId); }
			const order = rankGroup(matches);
			expect(new Set(order).size, `seed ${seed}: duplicates in output`).toBe(order.length);
			expect(order.length, `seed ${seed}: wrong size`).toBe(ids.size);
			for (const id of order) expect(ids.has(id), `seed ${seed}: unknown team ${id}`).toBe(true);
		}
	});

	it('points are non-increasing down the table', () => {
		for (let seed = 1; seed <= CASES; seed++) {
			const { matches } = randomCase(mulberry32(seed));
			const order = rankGroup(matches);
			const pts = pointsTable(matches);
			for (let i = 1; i < order.length; i++) {
				expect(
					pts.get(order[i - 1])! >= pts.get(order[i])!,
					`seed ${seed}: ${order[i - 1]} (${pts.get(order[i - 1])}pts) above ${order[i]} (${pts.get(order[i])}pts)`
				).toBe(true);
			}
		}
	});

	it('within equal points, overall GD then GF are non-increasing (FIFA order)', () => {
		for (let seed = 1; seed <= CASES; seed++) {
			const { matches } = randomCase(mulberry32(seed));
			const order = rankGroup(matches);
			const pts = pointsTable(matches);
			const t = gdGf(matches);
			for (let i = 1; i < order.length; i++) {
				const a = order[i - 1], b = order[i];
				if (pts.get(a) !== pts.get(b)) continue;
				const ta = t.get(a)!, tb = t.get(b)!;
				expect(
					ta.gd > tb.gd || (ta.gd === tb.gd && ta.gf >= tb.gf),
					`seed ${seed}: GD/GF order broken between ${a} and ${b}`
				).toBe(true);
			}
		}
	});

	it('is deterministic (same input twice -> same output)', () => {
		for (let seed = 1; seed <= 500; seed++) {
			const { matches } = randomCase(mulberry32(seed));
			expect(rankGroup(matches)).toEqual(rankGroup(matches.slice()));
		}
	});

	it('preferredOrder never lets a team outrank one with more points', () => {
		for (let seed = 1; seed <= CASES; seed++) {
			const rnd = mulberry32(seed);
			const { matches } = randomCase(rnd);
			const ids = [...new Set(matches.flatMap((m) => [m.homeTeamId, m.awayTeamId]))];
			// random preferred order: a shuffled copy of the ids
			const preferred = ids.slice().sort(() => rnd() - 0.5);
			const order = rankGroup(matches, preferred);
			const pts = pointsTable(matches);
			for (let i = 1; i < order.length; i++) {
				expect(
					pts.get(order[i - 1])! >= pts.get(order[i])!,
					`seed ${seed}: preferredOrder let ${order[i - 1]} outrank on fewer points`
				).toBe(true);
			}
			// and teams LEVEL on points must follow the preferred relative order
			const prefIdx = new Map(preferred.map((id, i) => [id, i]));
			for (let i = 1; i < order.length; i++) {
				const a = order[i - 1], b = order[i];
				if (pts.get(a) !== pts.get(b)) continue;
				expect(
					prefIdx.get(a)! < prefIdx.get(b)!,
					`seed ${seed}: level-on-points pair ${a},${b} ignores preferredOrder`
				).toBe(true);
			}
		}
	});

	it('handles empty and single-match inputs without throwing', () => {
		expect(rankGroup([])).toEqual([]);
		expect(rankGroup([{ homeTeamId: 7, awayTeamId: 9, homeScore: 1, awayScore: 1 }]).length).toBe(2);
	});
});
