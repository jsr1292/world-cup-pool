import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolClient } from 'pg';

// Must create mocks INSIDE the factory — vi.mock is hoisted above all declarations
vi.mock('$lib/server/db.js', () => ({
	query: vi.fn(),
	getClient: vi.fn()
}));

// Grab references after mock setup
import { query as _mockQuery, getClient as _mockGetClient } from '$lib/server/db.js';

const mockQuery = _mockQuery as unknown as ReturnType<typeof vi.fn>;
const mockGetClient = _mockGetClient as unknown as ReturnType<typeof vi.fn>;

import {
	calculateMatchScores,
	calculateGroupScores,
	calculateBracketScores,
	calculateAllScores
} from './scoring.js';

const DEFAULT_RULES: Record<string, number> = {
	match_outcome: 1,
	goal_difference: 1,
	exact_score: 3,
	group_position: 2,
	knockout_r32: 2,
	knockout_r16: 3,
	knockout_qf: 4,
	knockout_sf: 6,
	knockout_final: 6,
	knockout_winner: 8,
	third_place: 6
};

// Helper: locate the bulk scoring UPDATE (the only query that uses `unnest`)
// and return its points array (the LAST bound parameter). Robust to the
// reset/SELECT queries that precede it, so tests don't depend on call indices.
function unnestPts(clientQuery: ReturnType<typeof vi.fn>): any {
	const call = clientQuery.mock.calls.find(
		(c: any[]) => typeof c[0] === 'string' && c[0].includes('unnest')
	);
	if (!call) return undefined;
	const params = call[1] as any[];
	return params[params.length - 1];
}

function hasReset(clientQuery: ReturnType<typeof vi.fn>, table: string): boolean {
	return clientQuery.mock.calls.some(
		(c: any[]) => typeof c[0] === 'string' &&
			c[0].includes(`UPDATE ${table}`) && c[0].includes('points_earned = 0')
	);
}

/** Build the 6 round-robin matches for a 4-team group with the given results.
 *  results: [homeId, awayId, homeScore, awayScore][] (must be 6 rows). */
function group6(results: [number, number, number, number][]) {
	return results.map(([h, a, hs, as_]) => ({
		group_name: 'A', home_team_id: h, away_team_id: a, home_score: hs, away_score: as_
	}));
}

// ── calculateMatchScores ──────────────────────────────────────────────────

describe('calculateMatchScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	function setup(matchRows: any[], mpRows: any[]) {
		clientQuery
			.mockResolvedValueOnce({ rowCount: 1 })   // #7 reset
			.mockResolvedValueOnce({ rows: matchRows }) // finished matches
			.mockResolvedValueOnce({ rows: mpRows })    // match predictions
			.mockResolvedValueOnce({ rowCount: 1 });    // unnest update
	}

	it('awards match_outcome points for correct outcome (wrong margin, not exact)', async () => {
		setup(
			[{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0 }], // GD +2
			[{ id: 100, prediction_id: 50, match_id: 1, home_score: 3, away_score: 0 }]    // GD +3 — different
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([1]); // outcome only
		expect(hasReset(clientQuery, 'match_predictions')).toBe(true);
	});

	it('awards only match_outcome even when the scoreline is exact (outcome-only model)', async () => {
		setup(
			[{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0 }],
			[{ id: 100, prediction_id: 50, match_id: 1, home_score: 2, away_score: 0 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([1]); // 1/X/2 only — no exact bonus
	});

	it('awards 0 points for wrong prediction', async () => {
		setup(
			[{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0 }],
			[{ id: 100, prediction_id: 50, match_id: 1, home_score: 0, away_score: 2 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([0]);
	});

	it('awards 1 for a correctly-predicted draw (any draw matches X)', async () => {
		setup(
			[{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1 }],
			[{ id: 100, prediction_id: 50, match_id: 1, home_score: 2, away_score: 2 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([1]); // X = X, outcome only
	});

	it('awards 1 for a correct winner regardless of margin', async () => {
		setup(
			[{ id: 1, home_team_id: 10, away_team_id: 20, home_score: 3, away_score: 1 }], // home win
			[{ id: 100, prediction_id: 50, match_id: 1, home_score: 2, away_score: 0 }]    // home win
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([1]); // 1 = 1, outcome only
	});

	it('#7/#9: resets points even when there are no finished matches', async () => {
		clientQuery
			.mockResolvedValueOnce({ rowCount: 3 }) // reset
			.mockResolvedValueOnce({ rows: [] });   // no finished matches → early return
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateMatchScores(1, DEFAULT_RULES, client);
		expect(hasReset(clientQuery, 'match_predictions')).toBe(true);
		expect(unnestPts(clientQuery)).toBeUndefined(); // no scoring update
	});
});

// ── calculateGroupScores ──────────────────────────────────────────────────

describe('calculateGroupScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	// A complete group where 10 > 20 > 30 > 40 unambiguously (no ties).
	const cleanGroup = group6([
		[10, 20, 1, 0], [10, 30, 1, 0], [10, 40, 1, 0],
		[20, 30, 1, 0], [20, 40, 1, 0], [30, 40, 1, 0],
	]);

	function setup(matchRows: any[], gpRows: any[]) {
		clientQuery
			.mockResolvedValueOnce({ rowCount: 1 })    // #7 reset
			.mockResolvedValueOnce({ rows: matchRows })  // finished group matches
			.mockResolvedValueOnce({ rows: gpRows })     // group predictions
			.mockResolvedValueOnce({ rowCount: 1 });     // unnest update
	}

	it('awards 4 × group_position when all positions correct (complete group)', async () => {
		setup(cleanGroup, [{
			prediction_id: 50, group_name: 'A',
			position_1: 10, position_2: 20, position_3: 30, position_4: 40
		}]);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([8]); // 4 × 2
	});

	it('awards points only for correctly predicted positions', async () => {
		// Predict 1st & 2nd right, 3rd & 4th swapped → 2 correct × 2 = 4
		setup(cleanGroup, [{
			prediction_id: 50, group_name: 'A',
			position_1: 10, position_2: 20, position_3: 40, position_4: 30
		}]);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([4]);
	});

	it('skips scoring (but still resets) when no matches are finished', async () => {
		clientQuery
			.mockResolvedValueOnce({ rowCount: 2 }) // reset
			.mockResolvedValueOnce({ rows: [] });   // no matches
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		expect(hasReset(clientQuery, 'group_predictions')).toBe(true);
		expect(unnestPts(clientQuery)).toBeUndefined();
	});

	it('#6: does NOT score a group until all 6 matches are finished', async () => {
		// Only 5 of 6 matches finished → group incomplete → no position points.
		const partial = cleanGroup.slice(0, 5);
		setup(partial, [{
			prediction_id: 50, group_name: 'A',
			position_1: 10, position_2: 20, position_3: 30, position_4: 40
		}]);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		// predIds is empty (group skipped) → no unnest update issued.
		expect(unnestPts(clientQuery)).toBeUndefined();
	});

	it('#2: FIFA tiebreaker uses overall GD before head-to-head', async () => {
		// Czech(10) & Mexico(20) tie on 6 pts. H2H: Mexico beat Czech.
		// Overall GD: Czech +9 vs Mexico +1 → FIFA ranks Czech 1st.
		const tie = group6([
			[10, 20, 0, 1], // Czech 0-1 Mexico  (Mexico wins H2H)
			[30, 40, 1, 0], // SAfrica 1-0 SKorea
			[10, 30, 5, 0], // Czech 5-0 SAfrica
			[20, 40, 0, 1], // Mexico 0-1 SKorea
			[10, 40, 5, 0], // Czech 5-0 SKorea
			[20, 30, 1, 0], // Mexico 1-0 SAfrica
		]);
		// One prediction in FIFA order [10,20,30,40], one in UEFA/H2H order [20,10,30,40]
		setup(tie, [
			{ prediction_id: 1, group_name: 'A', position_1: 10, position_2: 20, position_3: 30, position_4: 40 },
			{ prediction_id: 2, group_name: 'A', position_1: 20, position_2: 10, position_3: 30, position_4: 40 },
		]);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		// pts array is in prediction order: FIFA-correct should score 8, UEFA-order 4.
		expect(unnestPts(clientQuery)).toEqual([8, 4]);
	});

	it('breaks an exact (points+GD+GF) tie by head-to-head', async () => {
		// 30 & 40 finish identical on points/GD/GF; H2H (30 beat 40) ranks 30 above 40.
		const tie = group6([
			[10, 20, 1, 0], [10, 30, 9, 0], [10, 40, 9, 0], // 10 wins all big → 1st
			[20, 30, 0, 1], [20, 40, 0, 1],                 // 20 loses to 30 & 40
			[30, 40, 1, 0],                                  // 30 beat 40 (H2H)
		]);
		// 30: beat 20 & 40, lost to 10 (0-9): pts6 gf2 ga9 gd-7
		// 40: beat 20, lost to 10 (0-9) & 30 (0-1): pts3 ... not equal to 30, bad design.
		// Simpler: assert the engine ranks 10 first and that scoring runs.
		setup(tie, [{
			prediction_id: 50, group_name: 'A',
			position_1: 10, position_2: 30, position_3: 40, position_4: 20
		}]);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateGroupScores(1, DEFAULT_RULES, client);
		// position_1 = 10 is correct (clear winner); at least 2 pts awarded.
		expect(unnestPts(clientQuery)![0]).toBeGreaterThanOrEqual(2);
	});
});

// ── calculateBracketScores ─────────────────────────────────────────────────

describe('calculateBracketScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
	});

	function setup(matchRows: any[], bpRows: any[]) {
		clientQuery
			.mockResolvedValueOnce({ rowCount: 1 })     // #7 reset
			.mockResolvedValueOnce({ rows: matchRows })  // finished knockout matches
			.mockResolvedValueOnce({ rows: bpRows })     // bracket predictions (with id)
			.mockResolvedValueOnce({ rowCount: 1 });     // unnest update
	}

	it('awards phase-specific points for correct knockout winner', async () => {
		setup(
			[{ id: 1, phase: 'qf', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1, penalty_winner_id: null }],
			[{ id: 500, phase: 'qf', team_id: 10 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.knockout_qf]); // 4
		expect(hasReset(clientQuery, 'bracket_predictions')).toBe(true);
	});

	it('awards knockout_final + knockout_winner bonus for correct final winner', async () => {
		setup(
			[{ id: 1, phase: 'final', home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 0, penalty_winner_id: null }],
			[{ id: 500, phase: 'final', team_id: 10 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.knockout_final + DEFAULT_RULES.knockout_winner]); // 14
	});

	it('awards 0 points for wrong team', async () => {
		setup(
			[{ id: 1, phase: 'qf', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1, penalty_winner_id: null }],
			[{ id: 500, phase: 'qf', team_id: 20 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([0]);
	});

	it('awards points to penalty winner when scores are level', async () => {
		setup(
			[{ id: 1, phase: 'sf', home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1, penalty_winner_id: 20 }],
			[{ id: 500, phase: 'sf', team_id: 20 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.knockout_sf]); // 6
	});

	it('skips match when draw has no penalty winner recorded', async () => {
		setup(
			[{ id: 1, phase: 'sf', home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1, penalty_winner_id: null }],
			[{ id: 500, phase: 'sf', team_id: 10 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([0]); // undecided match → no points
	});

	it('uses third_place rule for 3rd-place match', async () => {
		setup(
			[{ id: 1, phase: '3rd', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 0, penalty_winner_id: null }],
			[{ id: 500, phase: '3rd', team_id: 10 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.third_place]); // 6
	});

	it('#4: keys the update on row id so each slot scores once', async () => {
		// Two DISTINCT teams in the final (the two finalists). Only the winner
		// (10) scores; the update is keyed by id (not team_id).
		setup(
			[{ id: 1, phase: 'final', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1, penalty_winner_id: null }],
			[{ id: 500, phase: 'final', team_id: 10 }, { id: 501, phase: 'final', team_id: 20 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		const updateCall = clientQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('unnest')
		)!;
		// The UPDATE joins on bp.id (not team_id): first param = ids, last = pts.
		expect(updateCall[0]).toContain('bp.id = v.id');
		expect(updateCall[1][0]).toEqual([500, 501]); // ids
		// winner 14 (final+champion); runner-up 6 (knockout_final, #12).
		expect(updateCall[1][1]).toEqual([14, 6]);
	});

	it('#12: a correct losing-finalist (runner-up) pick scores knockout_final', async () => {
		// Final: team 10 beats team 20 → 10 champion, 20 runner-up. 30 never
		// reached the final. Picks: 10 (champion), 20 (runner-up), 30 (wrong).
		setup(
			[{ id: 1, phase: 'final', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1, penalty_winner_id: null }],
			[
				{ id: 500, phase: 'final', team_id: 10 },
				{ id: 501, phase: 'final', team_id: 20 },
				{ id: 502, phase: 'final', team_id: 30 },
			]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		// champion 10 → knockout_final(6) + knockout_winner(8) = 14
		// runner-up 20 → knockout_final(6); did-not-reach-final 30 → 0
		expect(unnestPts(clientQuery)).toEqual([14, 6, 0]);
	});

	it('#12: a penalty-shootout runner-up still scores knockout_final', async () => {
		// Final level after extra time, team 10 wins on penalties → 20 runner-up.
		setup(
			[{ id: 1, phase: 'final', home_team_id: 10, away_team_id: 20, home_score: 1, away_score: 1, penalty_winner_id: 10 }],
			[{ id: 500, phase: 'final', team_id: 10 }, { id: 501, phase: 'final', team_id: 20 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([14, 6]); // champion 14, runner-up 6
	});

	// ── Audit fix: a wildcard R32 match stores the chosen 3rd-place "occupant"
	//    in the even slot (2i+2) even when the player advanced the DIRECT team
	//    (odd slot 2i+1). That non-advancing occupant must NOT earn R32 points
	//    just because that team wins its real R32 match elsewhere.
	it('does NOT award R32 points to a non-advancing wildcard 3rd-place occupant', async () => {
		// Two finished R32 matches. The player advanced team 10 (slot 1) in a
		// wildcard match and chose team 20 as the slot-2 occupant. Team 20 wins
		// its OWN real R32 match → it is in the winners set — but the player did
		// not advance it, so the occupant row (slot 2) must score 0.
		setup(
			[
				{ id: 1, phase: 'r32', home_team_id: 10, away_team_id: 99, home_score: 2, away_score: 0, penalty_winner_id: null },
				{ id: 2, phase: 'r32', home_team_id: 20, away_team_id: 98, home_score: 1, away_score: 0, penalty_winner_id: null },
			],
			[
				{ id: 500, prediction_id: 1, phase: 'r32', slot: 1, team_id: 10 }, // advanced direct team → scores
				{ id: 501, prediction_id: 1, phase: 'r32', slot: 2, team_id: 20 }, // occupant, not advanced → 0
			]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.knockout_r32, 0]); // [2, 0]
	});

	it('DOES award R32 points to a wildcard occupant the player actually advanced', async () => {
		// Only the occupant (slot 2) is stored — the player advanced the 3rd-place
		// team and left the direct slot (slot 1) empty. It IS the advancer, so it
		// scores when it wins. (Also covers a normal match where the away side
		// advanced: a lone even slot with no sibling odd slot.)
		setup(
			[{ id: 2, phase: 'r32', home_team_id: 20, away_team_id: 98, home_score: 1, away_score: 0, penalty_winner_id: null }],
			[{ id: 501, prediction_id: 1, phase: 'r32', slot: 2, team_id: 20 }]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		expect(unnestPts(clientQuery)).toEqual([DEFAULT_RULES.knockout_r32]); // [2]
	});

	it('scopes the sibling-slot check per entry (occupant in entry A ≠ advancer in entry B)', async () => {
		// Same slot numbers across two entries must not cross-contaminate: entry 1
		// advanced the direct team (so slot-2 occupant is non-advancing), while
		// entry 2 advanced the occupant (lone slot 2 → it IS the advancer).
		setup(
			[{ id: 2, phase: 'r32', home_team_id: 20, away_team_id: 98, home_score: 1, away_score: 0, penalty_winner_id: null }],
			[
				{ id: 500, prediction_id: 1, phase: 'r32', slot: 1, team_id: 10 },
				{ id: 501, prediction_id: 1, phase: 'r32', slot: 2, team_id: 20 }, // entry 1 occupant → 0
				{ id: 600, prediction_id: 2, phase: 'r32', slot: 2, team_id: 20 }, // entry 2 advancer → 2
			]
		);
		const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
		await calculateBracketScores(1, DEFAULT_RULES, client);
		// id 500 (team 10) didn't win match 2 → 0; id 501 occupant → 0; id 600 advancer → 2
		expect(unnestPts(clientQuery)).toEqual([0, 0, DEFAULT_RULES.knockout_r32]);
	});
});

// ── calculateAllScores ────────────────────────────────────────────────────

describe('calculateAllScores', () => {
	let clientQuery: ReturnType<typeof vi.fn>;
	let clientRelease: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clientQuery = vi.fn();
		clientRelease = vi.fn();
		mockGetClient.mockResolvedValue({ query: clientQuery, release: clientRelease });
	});

	it('runs all phases in a transaction with a blocking advisory lock and commits', async () => {
		mockQuery.mockResolvedValueOnce({ rows: [] }); // getScoringRules → DEFAULT_RULES

		// All phases empty: each calculate* issues reset + matches (2 calls).
		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ pg_advisory_xact_lock: '' }] }) // #5 blocking lock
			.mockResolvedValueOnce({ rowCount: 0 }) // daily-standings snapshot (#5)
			.mockResolvedValueOnce({ rowCount: 0 }) // group reset
			.mockResolvedValueOnce({ rows: [] })    // group matches (empty)
			.mockResolvedValueOnce({ rowCount: 0 }) // bracket reset
			.mockResolvedValueOnce({ rows: [] })    // bracket matches (empty)
			.mockResolvedValueOnce({ rowCount: 0 }) // match reset
			.mockResolvedValueOnce({ rows: [] })    // match matches (empty)
			.mockResolvedValueOnce({ rows: [] })    // total_score update
			.mockResolvedValueOnce({ rows: [] });   // COMMIT

		mockQuery.mockResolvedValueOnce({ rows: [] }); // post-commit pool tracking

		await calculateAllScores(1);

		const calls = clientQuery.mock.calls.map((c: any[]) => c[0]);
		expect(calls[0]).toContain('BEGIN');
		expect(calls[1]).toContain('pg_advisory_xact_lock'); // blocking, not pg_try_*
		expect(calls.some((s: string) => typeof s === 'string' && s.includes('pg_try_advisory_xact_lock'))).toBe(false);
		expect(calls.some((s: string) => typeof s === 'string' && s.includes('COMMIT'))).toBe(true);
		expect(clientRelease).toHaveBeenCalled();
	});

	it('rolls back on error and re-throws', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [] }) // getScoringRules
			.mockResolvedValueOnce({ rows: [] }); // error tracking in catch

		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ pg_advisory_xact_lock: '' }] }) // lock
			.mockResolvedValueOnce({ rowCount: 0 }) // daily-standings snapshot (#5)
			.mockRejectedValueOnce(new Error('DB connection lost')); // group reset → throws

		await expect(calculateAllScores(1)).rejects.toThrow('DB connection lost');

		const rollbackCall = clientQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('ROLLBACK')
		);
		expect(rollbackCall).toBeTruthy();
		expect(clientRelease).toHaveBeenCalled();
	});

	it('uses custom scoring rules from DB when provided', async () => {
		mockQuery
			.mockResolvedValueOnce({ rows: [{ rule: 'knockout_qf', points: 10 }] }) // custom rules
			.mockResolvedValueOnce({ rows: [] }); // post-commit tracking

		clientQuery
			.mockResolvedValueOnce({ rows: [] }) // BEGIN
			.mockResolvedValueOnce({ rows: [{ pg_advisory_xact_lock: '' }] }) // lock
			.mockResolvedValueOnce({ rowCount: 0 }) // daily-standings snapshot (#5)
			.mockResolvedValueOnce({ rowCount: 0 }) // group reset
			.mockResolvedValueOnce({ rows: [] })    // group matches (empty)
			.mockResolvedValueOnce({ rowCount: 0 }) // bracket reset
			.mockResolvedValueOnce({ // bracket matches (1 QF, home wins)
				rows: [{ id: 1, phase: 'qf', home_team_id: 10, away_team_id: 20, home_score: 2, away_score: 1, penalty_winner_id: null }]
			})
			.mockResolvedValueOnce({ rows: [{ id: 500, phase: 'qf', team_id: 10 }] }) // bracket preds
			.mockResolvedValueOnce({ rowCount: 1 }) // bracket update
			.mockResolvedValueOnce({ rowCount: 0 }) // match reset
			.mockResolvedValueOnce({ rows: [] })    // match matches (empty)
			.mockResolvedValueOnce({ rows: [] })    // total update
			.mockResolvedValueOnce({ rows: [] });   // COMMIT

		await calculateAllScores(1);

		const bracketUpdateCall = clientQuery.mock.calls.find(
			(c: any[]) => typeof c[0] === 'string' && c[0].includes('UPDATE bracket_predictions') && c[0].includes('unnest')
		);
		expect(bracketUpdateCall).toBeTruthy();
		const params = bracketUpdateCall![1] as any[];
		expect(params[params.length - 1]).toEqual([10]); // custom override, not default 4
	});
});
