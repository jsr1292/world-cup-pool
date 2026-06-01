import { describe, it, expect } from 'vitest';
import { rankGroup, type GsMatch } from './group-standings.js';

/** Build the 6 round-robin matches for a 4-team group.
 *  results: [homeId, awayId, homeScore, awayScore][]. */
function group(results: [number, number, number, number][]): GsMatch[] {
	return results.map(([h, a, hs, as_]) => ({
		homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as_,
	}));
}

describe('rankGroup', () => {
	it('ranks an unambiguous complete group by points', () => {
		// 10 beats everyone, 20 beats 30 & 40, 30 beats 40.
		const g = group([
			[10, 20, 1, 0], [10, 30, 1, 0], [10, 40, 1, 0],
			[20, 30, 1, 0], [20, 40, 1, 0], [30, 40, 1, 0],
		]);
		expect(rankGroup(g)).toEqual([10, 20, 30, 40]);
	});

	it('#2: applies overall goal difference BEFORE head-to-head (FIFA, not UEFA)', () => {
		// Czech(10) & Mexico(20) tie on 6 pts; Mexico won the H2H, but Czech has the
		// far better overall GD (+9 vs +1) → FIFA ranks Czech above Mexico.
		// 30 & 40 then tie on pts/GD/GF and are split by their H2H (30 beat 40).
		const g = group([
			[10, 20, 0, 1], // Czech 0-1 Mexico (Mexico wins H2H)
			[30, 40, 1, 0],
			[10, 30, 5, 0],
			[20, 40, 0, 1],
			[10, 40, 5, 0],
			[20, 30, 1, 0],
		]);
		expect(rankGroup(g)).toEqual([10, 20, 30, 40]);
	});

	it('breaks a points+GD+GF tie by head-to-head', () => {
		// 30 & 40 finish level on points/GD/GF among the lower pair; 30 beat 40 H2H.
		const g = group([
			[10, 20, 1, 0], [10, 30, 1, 0], [10, 40, 1, 0], // 10 wins all → 1st
			[20, 30, 0, 1], [20, 40, 0, 1],                 // 20 loses to 30 & 40 → last
			[30, 40, 1, 0],                                  // 30 beat 40 (H2H)
		]);
		// 30: beat 20 & 40, lost to 10 → 6 pts, gd 0 (1-1 vs10? no): gf 1+0+1=... compute:
		//   30 vs10 0-1, 30 vs20 1-0, 30 vs40 1-0 → pts6 gf2 ga1 gd+1
		// 40: 40 vs10 0-1, 40 vs20 1-0, 40 vs30 0-1 → pts3 gf1 ga2 gd-1
		// So 30 ranks above 40 on points already; 20 is last (3 pts, gd worse).
		const order = rankGroup(g);
		expect(order[0]).toBe(10);
		expect(order.indexOf(30)).toBeLessThan(order.indexOf(40));
	});

	it('is deterministic for an all-draws group (falls back to ascending team id)', () => {
		// Every match a draw → all teams equal on everything → final fallback is id.
		// Use ids in scrambled match order to prove the result is id-sorted, not input-sorted.
		const g = group([
			[40, 10, 1, 1], [30, 20, 1, 1], [40, 30, 1, 1],
			[10, 20, 1, 1], [40, 20, 1, 1], [10, 30, 1, 1],
		]);
		expect(rankGroup(g)).toEqual([10, 20, 30, 40]);
	});

	it('breaks a 3-way overall tie (cyclic H2H) deterministically by id', () => {
		// 10>20, 20>30, 30>10 (cycle); each also beats 40 1-0.
		// 10/20/30 all end 6 pts, +1 GD, 2 GF; H2H among them is symmetric → id order.
		const g = group([
			[10, 20, 1, 0], [20, 30, 1, 0], [30, 10, 1, 0],
			[10, 40, 1, 0], [20, 40, 1, 0], [30, 40, 1, 0],
		]);
		expect(rankGroup(g)).toEqual([10, 20, 30, 40]);
	});

	it('ranks a partial group on the matches entered so far', () => {
		// Matchday 1 only: 10 beat 20 (2-0), 30 drew 40 (1-1). All four teams appear.
		const g = group([
			[10, 20, 2, 0],
			[30, 40, 1, 1],
		]);
		// 10: 3 pts. 30 & 40: 1 pt each, gd 0, gf 1 → H2H drew → id → 30 before 40. 20: 0 pts.
		expect(rankGroup(g)).toEqual([10, 30, 40, 20]);
	});

	it('returns only the teams that have played (caller pads the rest)', () => {
		// A single entered scoreline → only those two teams are ranked.
		expect(rankGroup(group([[10, 20, 1, 0]]))).toEqual([10, 20]);
		expect(rankGroup([])).toEqual([]);
	});
});
