/**
 * Match-fixtures seeder — FIFA World Cup 2026.
 *
 * Populates the `matches` table with:
 *   - 72 group-stage matches: 12 groups (A–L) × 6 round-robin matches each,
 *     with real team assignments (every team plays the other three in its group).
 *   - 32 knockout placeholder matches: R32 (16) → R16 (8) → QF (4) → SF (2)
 *     → 3rd-place (1) → Final (1). Teams are left NULL because the matchups
 *     are unknown until the group stage finishes.
 *   Total: 104 matches (the full 2026 tournament).
 *
 * Requires teams to be seeded first (`npm run seed`). Run AFTER migrate + seed:
 *   npm run seed:matches            # idempotent: skips if matches already exist
 *   npm run seed:matches -- --force # wipe existing matches and reseed
 *
 * Group kickoff times are stamped from the official 2026 schedule (see
 * GROUP_SCHEDULE / setGroupKickoffs) so matches show real dates/times and lock
 * per-match as they kick off. Pool-level `deadline_group` / `deadline_knockout`
 * still apply on top. Knockout kickoff times stay NULL until the bracket is set.
 *
 * Knockout note: the app's admin panel can set knockout scores and (after the
 * results-API enhancement) the two competing teams. Group-stage scoring works
 * out of the box once results are entered.
 */
import './load-env.js';
import pg from 'pg';

/** Round-robin schedule for a 4-team group, indexed into the group's team list. */
const ROUND_ROBIN: { matchday: number; pairs: [number, number][] }[] = [
	{ matchday: 1, pairs: [[0, 1], [2, 3]] },
	{ matchday: 2, pairs: [[0, 2], [1, 3]] },
	{ matchday: 3, pairs: [[0, 3], [1, 2]] }
];

/** Knockout bracket shape for the 2026 (48-team) format. Phase keys match the
 *  CHECK constraint in 0009 and the scoring rule keys in scoring.ts. */
const KNOCKOUT: { phase: string; count: number }[] = [
	{ phase: 'r32', count: 16 },
	{ phase: 'r16', count: 8 },
	{ phase: 'qf', count: 4 },
	{ phase: 'sf', count: 2 },
	{ phase: '3rd', count: 1 },
	{ phase: 'final', count: 1 }
];

/**
 * Official FIFA World Cup 2026 group-stage schedule (kick-off times in UTC),
 * sourced from the per-group Wikipedia fixture tables. Keyed by group; each
 * fixture is { home, away, utc } where the names are the EXACT seeded team names
 * and `utc` is an ISO-8601 instant. These are applied by `setGroupKickoffs`,
 * which matches each fixture to its seeded match by the (unordered) team pair —
 * so the seed's generic round-robin pairing is irrelevant; only the two teams
 * are used to locate the row. Re-running is idempotent (same value re-written).
 */
export const GROUP_SCHEDULE: Record<string, { home: string; away: string; utc: string }[]> = {
	A: [
		{ home: 'Mexico', away: 'South Africa', utc: '2026-06-11T19:00:00Z' },
		{ home: 'South Korea', away: 'Czech Republic', utc: '2026-06-12T02:00:00Z' },
		{ home: 'Czech Republic', away: 'South Africa', utc: '2026-06-18T16:00:00Z' },
		{ home: 'Mexico', away: 'South Korea', utc: '2026-06-19T01:00:00Z' },
		{ home: 'Czech Republic', away: 'Mexico', utc: '2026-06-25T01:00:00Z' },
		{ home: 'South Africa', away: 'South Korea', utc: '2026-06-25T01:00:00Z' },
	],
	B: [
		{ home: 'Canada', away: 'Bosnia and Herzegovina', utc: '2026-06-12T19:00:00Z' },
		{ home: 'Qatar', away: 'Switzerland', utc: '2026-06-13T19:00:00Z' },
		{ home: 'Switzerland', away: 'Bosnia and Herzegovina', utc: '2026-06-18T19:00:00Z' },
		{ home: 'Canada', away: 'Qatar', utc: '2026-06-18T22:00:00Z' },
		{ home: 'Switzerland', away: 'Canada', utc: '2026-06-24T19:00:00Z' },
		{ home: 'Bosnia and Herzegovina', away: 'Qatar', utc: '2026-06-24T19:00:00Z' },
	],
	C: [
		{ home: 'Brazil', away: 'Morocco', utc: '2026-06-13T22:00:00Z' },
		{ home: 'Haiti', away: 'Scotland', utc: '2026-06-14T01:00:00Z' },
		{ home: 'Scotland', away: 'Morocco', utc: '2026-06-19T22:00:00Z' },
		{ home: 'Brazil', away: 'Haiti', utc: '2026-06-20T00:30:00Z' },
		{ home: 'Scotland', away: 'Brazil', utc: '2026-06-24T22:00:00Z' },
		{ home: 'Morocco', away: 'Haiti', utc: '2026-06-24T22:00:00Z' },
	],
	D: [
		{ home: 'United States', away: 'Paraguay', utc: '2026-06-12T01:00:00Z' },
		{ home: 'Australia', away: 'Turkey', utc: '2026-06-14T04:00:00Z' },
		{ home: 'United States', away: 'Australia', utc: '2026-06-19T19:00:00Z' },
		{ home: 'Turkey', away: 'Paraguay', utc: '2026-06-20T03:00:00Z' },
		{ home: 'Turkey', away: 'United States', utc: '2026-06-25T02:00:00Z' },
		{ home: 'Paraguay', away: 'Australia', utc: '2026-06-25T02:00:00Z' },
	],
	E: [
		{ home: 'Germany', away: 'Curaçao', utc: '2026-06-14T16:00:00Z' },
		{ home: 'Ivory Coast', away: 'Ecuador', utc: '2026-06-14T23:00:00Z' },
		{ home: 'Germany', away: 'Ivory Coast', utc: '2026-06-20T20:00:00Z' },
		{ home: 'Ecuador', away: 'Curaçao', utc: '2026-06-20T23:00:00Z' },
		{ home: 'Curaçao', away: 'Ivory Coast', utc: '2026-06-25T20:00:00Z' },
		{ home: 'Ecuador', away: 'Germany', utc: '2026-06-25T20:00:00Z' },
	],
	F: [
		{ home: 'Netherlands', away: 'Japan', utc: '2026-06-14T19:00:00Z' },
		{ home: 'Sweden', away: 'Tunisia', utc: '2026-06-15T02:00:00Z' },
		{ home: 'Netherlands', away: 'Sweden', utc: '2026-06-20T16:00:00Z' },
		{ home: 'Tunisia', away: 'Japan', utc: '2026-06-21T04:00:00Z' },
		{ home: 'Japan', away: 'Sweden', utc: '2026-06-25T22:00:00Z' },
		{ home: 'Tunisia', away: 'Netherlands', utc: '2026-06-25T22:00:00Z' },
	],
	G: [
		{ home: 'Iran', away: 'New Zealand', utc: '2026-06-15T01:00:00Z' },
		{ home: 'Belgium', away: 'Egypt', utc: '2026-06-15T19:00:00Z' },
		{ home: 'New Zealand', away: 'Egypt', utc: '2026-06-21T01:00:00Z' },
		{ home: 'Belgium', away: 'Iran', utc: '2026-06-21T19:00:00Z' },
		{ home: 'Egypt', away: 'Iran', utc: '2026-06-26T03:00:00Z' },
		{ home: 'New Zealand', away: 'Belgium', utc: '2026-06-26T03:00:00Z' },
	],
	H: [
		{ home: 'Spain', away: 'Cape Verde', utc: '2026-06-15T16:00:00Z' },
		{ home: 'Saudi Arabia', away: 'Uruguay', utc: '2026-06-15T22:00:00Z' },
		{ home: 'Spain', away: 'Saudi Arabia', utc: '2026-06-21T16:00:00Z' },
		{ home: 'Uruguay', away: 'Cape Verde', utc: '2026-06-21T22:00:00Z' },
		{ home: 'Cape Verde', away: 'Saudi Arabia', utc: '2026-06-27T00:00:00Z' },
		{ home: 'Uruguay', away: 'Spain', utc: '2026-06-27T00:00:00Z' },
	],
	I: [
		{ home: 'France', away: 'Senegal', utc: '2026-06-16T19:00:00Z' },
		{ home: 'Iraq', away: 'Norway', utc: '2026-06-16T22:00:00Z' },
		{ home: 'France', away: 'Iraq', utc: '2026-06-22T21:00:00Z' },
		{ home: 'Norway', away: 'Senegal', utc: '2026-06-23T00:00:00Z' },
		{ home: 'Norway', away: 'France', utc: '2026-06-26T19:00:00Z' },
		{ home: 'Senegal', away: 'Iraq', utc: '2026-06-26T19:00:00Z' },
	],
	J: [
		{ home: 'Argentina', away: 'Algeria', utc: '2026-06-16T00:00:00Z' },
		{ home: 'Austria', away: 'Jordan', utc: '2026-06-17T04:00:00Z' },
		{ home: 'Argentina', away: 'Austria', utc: '2026-06-22T16:00:00Z' },
		{ home: 'Jordan', away: 'Algeria', utc: '2026-06-23T03:00:00Z' },
		{ home: 'Algeria', away: 'Austria', utc: '2026-06-28T01:00:00Z' },
		{ home: 'Jordan', away: 'Argentina', utc: '2026-06-28T01:00:00Z' },
	],
	K: [
		{ home: 'Portugal', away: 'DR Congo', utc: '2026-06-17T16:00:00Z' },
		{ home: 'Uzbekistan', away: 'Colombia', utc: '2026-06-18T02:00:00Z' },
		{ home: 'Portugal', away: 'Uzbekistan', utc: '2026-06-23T16:00:00Z' },
		{ home: 'Colombia', away: 'DR Congo', utc: '2026-06-24T02:00:00Z' },
		{ home: 'Colombia', away: 'Portugal', utc: '2026-06-27T23:30:00Z' },
		{ home: 'DR Congo', away: 'Uzbekistan', utc: '2026-06-28T23:30:00Z' },
	],
	L: [
		{ home: 'England', away: 'Croatia', utc: '2026-06-17T19:00:00Z' },
		{ home: 'Ghana', away: 'Panama', utc: '2026-06-17T23:00:00Z' },
		{ home: 'England', away: 'Ghana', utc: '2026-06-23T20:00:00Z' },
		{ home: 'Panama', away: 'Croatia', utc: '2026-06-23T23:00:00Z' },
		{ home: 'Panama', away: 'England', utc: '2026-06-27T21:00:00Z' },
		{ home: 'Croatia', away: 'Ghana', utc: '2026-06-27T21:00:00Z' },
	],
};

/**
 * Apply the official kick-off times to the seeded group matches by matching each
 * scheduled fixture to its DB row via the (unordered) team pair. Idempotent and
 * safe to run whether or not the matches already had times. Returns the count of
 * group matches that ended up with a kickoff_time.
 */
export async function setGroupKickoffs(client: pg.PoolClient | pg.Client): Promise<number> {
	for (const [group, fixtures] of Object.entries(GROUP_SCHEDULE)) {
		for (const fx of fixtures) {
			await client.query(
				`UPDATE matches mt SET kickoff_time = $1::timestamptz
				 FROM teams a, teams b
				 WHERE mt.phase = 'group' AND mt.group_name = $2
				   AND a.name = $3 AND b.name = $4
				   AND ((mt.home_team_id = a.id AND mt.away_team_id = b.id)
				     OR (mt.home_team_id = b.id AND mt.away_team_id = a.id))`,
				[fx.utc, group, fx.home, fx.away]
			);
		}
	}
	const { rows } = await client.query(
		`SELECT COUNT(*)::int AS n FROM matches WHERE phase = 'group' AND kickoff_time IS NOT NULL`
	);
	return rows[0].n as number;
}

export interface SeedMatchesResult {
	skipped: boolean;
	groupMatches: number;
	knockoutMatches: number;
	total: number;
}

/**
 * Seed all fixtures using the given pg client (caller owns the transaction).
 * Exported so tests/validation harnesses can run it against any schema/DB.
 */
export async function seedMatchesWithClient(
	client: pg.PoolClient | pg.Client,
	opts: { force?: boolean } = {}
): Promise<SeedMatchesResult> {
	const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS n FROM matches');
	const existing = countRows[0].n as number;

	if (existing > 0 && !opts.force) {
		// Matches already exist — still (re)apply the official kick-off schedule so
		// upgrading deployments pick up the times without a destructive reseed.
		await setGroupKickoffs(client);
		return { skipped: true, groupMatches: 0, knockoutMatches: 0, total: existing };
	}
	if (opts.force) {
		// match_predictions cascade-delete via FK; bracket/group predictions
		// reference teams (not matches), so they are unaffected.
		await client.query('DELETE FROM matches');
	}

	// Load the 48 teams grouped by group_name (deterministic order by id).
	const { rows: teams } = await client.query(
		"SELECT id, group_name FROM teams WHERE group_name IS NOT NULL ORDER BY group_name, id"
	);
	const byGroup = new Map<string, number[]>();
	for (const t of teams) {
		if (!byGroup.has(t.group_name)) byGroup.set(t.group_name, []);
		byGroup.get(t.group_name)!.push(t.id);
	}
	if (byGroup.size === 0) {
		throw new Error('No teams with groups found — run `npm run seed` (teams) first.');
	}

	let groupMatches = 0;
	let sort = 0;
	for (const group of [...byGroup.keys()].sort()) {
		const ids = byGroup.get(group)!;
		if (ids.length !== 4) {
			throw new Error(`Group ${group} has ${ids.length} teams (expected 4) — reseed teams.`);
		}
		for (const { matchday, pairs } of ROUND_ROBIN) {
			for (const [a, b] of pairs) {
				sort++;
				await client.query(
					`INSERT INTO matches
					   (phase, matchday, group_name, home_team_id, away_team_id, status, sort_order, kickoff_time)
					 VALUES ('group', $1, $2, $3, $4, 'scheduled', $5, NULL)`,
					[matchday, group, ids[a], ids[b], sort]
				);
				groupMatches++;
			}
		}
	}

	let knockoutMatches = 0;
	let ksort = 1000;
	for (const { phase, count } of KNOCKOUT) {
		for (let slot = 1; slot <= count; slot++) {
			ksort++;
			await client.query(
				`INSERT INTO matches
				   (phase, matchday, group_name, home_team_id, away_team_id, status, sort_order, kickoff_time)
				 VALUES ($1, $2, NULL, NULL, NULL, 'scheduled', $3, NULL)`,
				[phase, slot, ksort]
			);
			knockoutMatches++;
		}
	}

	// Stamp the official 2026 kick-off times onto the freshly-created group rows.
	await setGroupKickoffs(client);

	return {
		skipped: false,
		groupMatches,
		knockoutMatches,
		total: groupMatches + knockoutMatches
	};
}

async function main(): Promise<void> {
	const force = process.argv.includes('--force');
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('[seed-matches] DATABASE_URL environment variable is required');
		process.exit(1);
	}

	const pool = new pg.Pool({
		connectionString: url,
		ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false }
	});
	const client = await pool.connect();
	try {
		await client.query('BEGIN');
		const res = await seedMatchesWithClient(client, { force });
		await client.query('COMMIT');

		if (res.skipped) {
			console.log(
				`[seed-matches] Skipped: ${res.total} matches already exist. Use --force to wipe and reseed.`
			);
		} else {
			console.log(
				`✓ Seeded ${res.total} matches (${res.groupMatches} group + ${res.knockoutMatches} knockout)`
			);
		}
	} catch (e) {
		await client.query('ROLLBACK');
		console.error('[seed-matches] Failed:', e);
		process.exit(1);
	} finally {
		client.release();
		await pool.end();
	}
}

// Only run when invoked directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
