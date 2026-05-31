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
 * Kickoff times are intentionally left NULL. The official 2026 kickoff schedule
 * is not embedded here, and inventing times would wrongly auto-lock predictions.
 * Prediction deadlines are instead controlled per-pool via `deadline_group` and
 * `deadline_knockout` (set on the pool admin page). Once FIFA confirms the
 * schedule, admins can populate `matches.kickoff_time` to enable per-match
 * locking; until then the pool-level deadlines govern.
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
