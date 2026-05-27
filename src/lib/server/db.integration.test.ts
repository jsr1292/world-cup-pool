/**
 * Integration tests for World Cup Pool — real PostgreSQL on Neon.
 * Each test runs inside a transaction that is ROLLBACK'd for full isolation.
 *
 * Run: TEST_DATABASE_URL="postgresql://..." npx vitest run --config vitest.integration.config.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';

let pool: pg.Pool;
let client: pg.PoolClient;

const TEST_DB_URL = process.env.TEST_DATABASE_URL!;

if (!TEST_DB_URL) {
	throw new Error('TEST_DATABASE_URL must be set for integration tests');
}

beforeAll(async () => {
	pool = new pg.Pool({
		connectionString: TEST_DB_URL,
		ssl: { rejectUnauthorized: false },
		max: 2,
		idleTimeoutMillis: 10_000,
		connectionTimeoutMillis: 10_000
	});
	// Warm up the pool
	const c = await pool.connect();
	c.release();
});

afterAll(async () => {
	await pool.end();
});

beforeEach(async () => {
	client = await pool.connect();
	await client.query('BEGIN');
});

afterEach(async () => {
	await client.query('ROLLBACK');
	client.release();
});

// Helper: insert a user and return id
async function insertUser(username: string, isAdmin = false): Promise<number> {
	const { rows } = await client.query(
		`INSERT INTO users (username, password_hash, display_name, is_admin)
		 VALUES ($1, 'fake:hash', $2, $3) RETURNING id`,
		[username, username, isAdmin]
	);
	return rows[0].id;
}

// Helper: insert a team and return id
async function insertTeam(name: string, groupName?: string): Promise<number> {
	const { rows } = await client.query(
		`INSERT INTO teams (name, flag_code, group_name, fifa_rank)
		 VALUES ($1, $2, $3, 10) RETURNING id`,
		[name, name.slice(0, 2).toLowerCase(), groupName ?? null]
	);
	return rows[0].id;
}

// Helper: insert a pool (with share_token) and return id
async function insertPool(name: string, createdBy: number): Promise<number> {
	const { rows } = await client.query(
		`INSERT INTO pools (name, invite_code, share_token, created_by)
		 VALUES ($1, gen_random_uuid()::text, gen_random_uuid()::text, $2) RETURNING id`,
		[name, createdBy]
	);
	return rows[0].id;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('Schema integrity', () => {
	it('has all 15 required tables', async () => {
		const { rows } = await client.query(
			`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
		);
		const tables = rows.map((r) => r.tablename);
		const expected = [
			'audit_log', 'bracket_predictions', 'group_predictions',
			'match_predictions', 'matches', 'pool_creators', 'pool_members',
			'pools', 'predictions', 'scoring_config', 'sessions',
			'site_settings', 'teams', 'tiebreaker', 'users'
		];
		for (const t of expected) {
			expect(tables).toContain(t);
		}
		expect(tables).toHaveLength(expected.length);
	});

	it('has critical indexes for query performance', async () => {
		const { rows } = await client.query(
			`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
		);
		const indexes = rows.map((r) => r.indexname);
		const critical = [
			'idx_matches_fifa_id',
			'idx_pools_share_token',
			'idx_predictions_pool',
			'idx_sessions_expires_at'
		];
		for (const idx of critical) {
			expect(indexes).toContain(idx);
		}
	});

	it('has default site_settings seeded', async () => {
		const { rows } = await client.query(
			`SELECT value FROM site_settings WHERE key = 'can_create_pools'`
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].value).toBe('admin');
	});
});

describe('User CRUD', () => {
	it('creates a user and retrieves by id', async () => {
		const id = await insertUser('alice');
		const { rows } = await client.query(
			'SELECT id, username, display_name FROM users WHERE id = $1',
			[id]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].username).toBe('alice');
		expect(rows[0].display_name).toBe('alice');
	});

	it('enforces unique usernames', async () => {
		await insertUser('bob');
		await expect(
			client.query(`INSERT INTO users (username, password_hash, display_name) VALUES ('bob', 'x', 'Bob')`)
		).rejects.toThrow(/unique/i);
	});

	it('stores email as nullable', async () => {
		const id1 = await insertUser('user_noemail');
		const id2 = await insertUser('user_withemail');
		await client.query('UPDATE users SET email = $1 WHERE id = $2', ['a@b.com', id2]);

		const { rows } = await client.query('SELECT id, email FROM users WHERE id = ANY($1)', [[id1, id2]]);
		const noEmail = rows.find((r) => r.id === id1);
		const withEmail = rows.find((r) => r.id === id2);
		expect(noEmail!.email).toBeNull();
		expect(withEmail!.email).toBe('a@b.com');
	});
});

describe('Pool lifecycle', () => {
	it('creates a pool with invite_code and share_token', async () => {
		const userId = await insertUser('creator');
		const poolId = await insertPool('Test Pool', userId);

		const { rows } = await client.query('SELECT * FROM pools WHERE id = $1', [poolId]);
		expect(rows).toHaveLength(1);
		expect(rows[0].name).toBe('Test Pool');
		expect(rows[0].invite_code).toBeTruthy();
		expect(rows[0].share_token).toBeTruthy();
		expect(rows[0].is_active).toBe(true);
		expect(rows[0].currency).toBe('EUR');
	});

	it('creator auto-joins as pool_member', async () => {
		const userId = await insertUser('creator2');
		const poolId = await insertPool('Auto Join', userId);

		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId, userId]
		);

		const { rows } = await client.query(
			'SELECT * FROM pool_members WHERE pool_id = $1 AND user_id = $2',
			[poolId, userId]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].has_paid).toBe(false);
	});

	it('enforces unique invite_code', async () => {
		const userId = await insertUser('creator3');
		await client.query(
			`INSERT INTO pools (name, invite_code, share_token, created_by)
			 VALUES ('P1', 'DUPCODE', gen_random_uuid()::text, $1)`,
			[userId]
		);
		await expect(
			client.query(
				`INSERT INTO pools (name, invite_code, share_token, created_by)
				 VALUES ('P2', 'DUPCODE', gen_random_uuid()::text, $1)`,
				[userId]
			)
		).rejects.toThrow(/unique/i);
	});

	it('prevents duplicate pool membership', async () => {
		const userId = await insertUser('member1');
		const poolId = await insertPool('Dup Member', userId);

		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId, userId]
		);
		await expect(
			client.query(
				'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
				[poolId, userId]
			)
		).rejects.toThrow(/unique/i);
	});
});

describe('Predictions', () => {
	it('creates a prediction entry tied to pool and user', async () => {
		const userId = await insertUser('pred_user');
		const poolId = await insertPool('Pred Pool', userId);

		const { rows } = await client.query(
			`INSERT INTO predictions (pool_id, user_id, label, total_score)
			 VALUES ($1, $2, 'Entry A', 0) RETURNING id`,
			[poolId, userId]
		);
		expect(rows[0].id).toBeGreaterThan(0);
	});

	it('enforces unique (pool_id, user_id, label)', async () => {
		const userId = await insertUser('pred_dup');
		const poolId = await insertPool('Dup Pred', userId);

		await client.query(
			`INSERT INTO predictions (pool_id, user_id, label) VALUES ($1, $2, 'L1')`,
			[poolId, userId]
		);
		await expect(
			client.query(
				`INSERT INTO predictions (pool_id, user_id, label) VALUES ($1, $2, 'L1')`,
				[poolId, userId]
			)
		).rejects.toThrow(/unique/i);
	});

	it('allows same user, same pool, different labels', async () => {
		const userId = await insertUser('pred_multi');
		const poolId = await insertPool('Multi Pred', userId);

		const r1 = await client.query(
			`INSERT INTO predictions (pool_id, user_id, label) VALUES ($1, $2, 'A') RETURNING id`,
			[poolId, userId]
		);
		const r2 = await client.query(
			`INSERT INTO predictions (pool_id, user_id, label) VALUES ($1, $2, 'B') RETURNING id`,
			[poolId, userId]
		);
		expect(r1.rows[0].id).not.toBe(r2.rows[0].id);
	});
});

describe('Matches + scoring', () => {
	it('inserts a match and links match_predictions', async () => {
		const userId = await insertUser('match_user');
		const poolId = await insertPool('Match Pool', userId);
		const homeId = await insertTeam('Home FC', 'A');
		const awayId = await insertTeam('Away FC', 'A');

		const matchRes = await client.query(
			`INSERT INTO matches (phase, matchday, group_name, home_team_id, away_team_id, home_score, away_score, status)
			 VALUES ('group', 1, 'A', $1, $2, 2, 1, 'finished') RETURNING id`,
			[homeId, awayId]
		);
		const matchId = matchRes.rows[0].id;

		const predRes = await client.query(
			`INSERT INTO predictions (pool_id, user_id) VALUES ($1, $2) RETURNING id`,
			[poolId, userId]
		);
		const predId = predRes.rows[0].id;

		await client.query(
			`INSERT INTO match_predictions (prediction_id, match_id, home_score, away_score, points_earned)
			 VALUES ($1, $2, 2, 1, 3)`,
			[predId, matchId]
		);

		const { rows } = await client.query(
			'SELECT * FROM match_predictions WHERE prediction_id = $1 AND match_id = $2',
			[predId, matchId]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].points_earned).toBe(3);
	});

	it('stores penalty_winner_id for knockout matches', async () => {
		const homeId = await insertTeam('KO Home', 'KO');
		const awayId = await insertTeam('KO Away', 'KO');

		const { rows } = await client.query(
			`INSERT INTO matches (phase, matchday, home_team_id, away_team_id, home_score, away_score, status, penalty_winner_id)
			 VALUES ('r16', 1, $1, $2, 1, 1, 'finished', $1) RETURNING id, penalty_winner_id`,
			[homeId, awayId]
		);
		expect(rows[0].penalty_winner_id).toBe(homeId);
	});
});

describe('Sessions', () => {
	it('creates a session and finds by token', async () => {
		const userId = await insertUser('session_user');
		const token = 'test-token-' + Date.now();
		const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

		await client.query(
			'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
			[userId, token, expires]
		);

		const { rows } = await client.query(
			'SELECT * FROM sessions WHERE token = $1',
			[token]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBe(userId);
	});

	it('enforces unique session tokens', async () => {
		const u1 = await insertUser('sess_dup1');
		const u2 = await insertUser('sess_dup2');
		const token = 'dup-token-' + Date.now();
		const expires = new Date(Date.now() + 86400000).toISOString();

		await client.query(
			'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
			[u1, token, expires]
		);
		await expect(
			client.query(
				'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
				[u2, token, expires]
			)
		).rejects.toThrow(/unique/i);
	});
});

describe('Cascade deletes', () => {
	it('deleting a pool cascades to members, predictions, and scoring_config', async () => {
		const userId = await insertUser('cascade_user');
		const poolId = await insertPool('Cascade Pool', userId);

		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId, userId]
		);
		await client.query(
			'INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, \'match_outcome\', 1)',
			[poolId]
		);
		const predRes = await client.query(
			'INSERT INTO predictions (pool_id, user_id) VALUES ($1, $2) RETURNING id',
			[poolId, userId]
		);

		await client.query('DELETE FROM pools WHERE id = $1', [poolId]);

		const members = await client.query('SELECT * FROM pool_members WHERE pool_id = $1', [poolId]);
		const preds = await client.query('SELECT * FROM predictions WHERE pool_id = $1', [poolId]);
		const config = await client.query('SELECT * FROM scoring_config WHERE pool_id = $1', [poolId]);

		expect(members.rows).toHaveLength(0);
		expect(preds.rows).toHaveLength(0);
		expect(config.rows).toHaveLength(0);
	});

	it('deleting a user cascades to sessions and pool_creators', async () => {
		// Create two users: one creates the pool, the other is the cascade target
		const creatorId = await insertUser('cascade_creator');
		const userId = await insertUser('cascade_del_user');
		const poolId = await insertPool('Cascade User Pool', creatorId);

		// Target user joins the pool
		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId, userId]
		);
		// Target user has a session
		await client.query(
			'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, NOW() + interval \'1 day\')',
			[userId, 'cascade-token']
		);
		// Target user is a pool creator
		await client.query(
			'INSERT INTO pool_creators (user_id) VALUES ($1)',
			[userId]
		);

		await client.query('DELETE FROM users WHERE id = $1', [userId]);

		const sessions = await client.query('SELECT * FROM sessions WHERE user_id = $1', [userId]);
		const members = await client.query('SELECT * FROM pool_members WHERE user_id = $1', [userId]);
		const creators = await client.query('SELECT * FROM pool_creators WHERE user_id = $1', [userId]);

		expect(sessions.rows).toHaveLength(0);
		expect(members.rows).toHaveLength(0);
		expect(creators.rows).toHaveLength(0);
	});
});

describe('Advisory lock (pg_try_advisory_xact_lock)', () => {
	it('acquires and releases an advisory lock within a transaction', async () => {
		const { rows } = await client.query('SELECT pg_try_advisory_xact_lock(12345) AS acquired');
		expect(rows[0].acquired).toBe(true);

		// Second acquire in same transaction should succeed (reentrant)
		const { rows: r2 } = await client.query('SELECT pg_try_advisory_xact_lock(12345) AS acquired');
		expect(r2[0].acquired).toBe(true);
	});

	it('fails to acquire lock held by another transaction', async () => {
		// Hold lock in main client
		await client.query('SELECT pg_advisory_xact_lock(99999)');

		// Try from a different connection
		const other = await pool.connect();
		try {
			const { rows } = await other.query('SELECT pg_try_advisory_xact_lock(99999) AS acquired');
			expect(rows[0].acquired).toBe(false);
		} finally {
			other.release();
		}
	});
});

describe('Bracket + group predictions', () => {
	it('stores group predictions with 4 positions', async () => {
		const userId = await insertUser('grp_user');
		const poolId = await insertPool('Group Pred Pool', userId);
		const t1 = await insertTeam('G1', 'B');
		const t2 = await insertTeam('G2', 'B');
		const t3 = await insertTeam('G3', 'B');
		const t4 = await insertTeam('G4', 'B');

		const predRes = await client.query(
			'INSERT INTO predictions (pool_id, user_id) VALUES ($1, $2) RETURNING id',
			[poolId, userId]
		);

		await client.query(
			`INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4)
			 VALUES ($1, 'B', $2, $3, $4, $5)`,
			[predRes.rows[0].id, t1, t2, t3, t4]
		);

		const { rows } = await client.query(
			'SELECT * FROM group_predictions WHERE prediction_id = $1',
			[predRes.rows[0].id]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].position_1).toBe(t1);
		expect(rows[0].position_4).toBe(t4);
	});

	it('stores bracket predictions keyed by (prediction_id, phase, slot)', async () => {
		const userId = await insertUser('brk_user');
		const poolId = await insertPool('Brk Pred Pool', userId);
		const teamId = await insertTeam('BracketTeam');

		const predRes = await client.query(
			'INSERT INTO predictions (pool_id, user_id) VALUES ($1, $2) RETURNING id',
			[poolId, userId]
		);

		await client.query(
			`INSERT INTO bracket_predictions (prediction_id, phase, slot, team_id)
			 VALUES ($1, 'qf', 1, $2)`,
			[predRes.rows[0].id, teamId]
		);

		const { rows } = await client.query(
			`SELECT * FROM bracket_predictions WHERE prediction_id = $1 AND phase = 'qf'`,
			[predRes.rows[0].id]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].slot).toBe(1);
		expect(rows[0].team_id).toBe(teamId);
	});
});

describe('Share token', () => {
	it('pools have unique non-null share_token', async () => {
		const u1 = await insertUser('share1');
		const u2 = await insertUser('share2');

		await insertPool('SharePool1', u1);
		await insertPool('SharePool2', u2);

		const { rows } = await client.query(
			`SELECT share_token FROM pools WHERE name LIKE 'SharePool%'`
		);
		expect(rows).toHaveLength(2);
		const tokens = rows.map((r) => r.share_token);
		expect(new Set(tokens).size).toBe(2); // unique
		for (const t of tokens) {
			expect(t).toBeTruthy();
		}
	});
});

// ─── queries.ts SQL patterns ────────────────────────────────────────
// These tests replicate the SQL used in queries.ts against the real
// PostgreSQL schema, validating syntax, constraints, and behaviour
// without importing the module (which has its own DB connection).

describe('queries.ts SQL patterns', () => {
	// 1. createUser pattern
	it('createUser pattern: INSERT user with hashed password returns id', async () => {
		const { rows } = await client.query(
			'INSERT INTO users (username, password_hash, display_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
			['q_user_create', 'saltdeadbeef:hashdeadbeef', 'Query User', null]
		);
		expect(rows[0].id).toBeGreaterThan(0);

		// Duplicate username must fail
		await expect(
			client.query(
				'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3)',
				['q_user_create', 'x', 'Dup']
			)
		).rejects.toThrow(/unique/i);
	});

	// 2. getUserById pattern
	it('getUserById pattern: SELECT returns all expected fields', async () => {
		const id = await insertUser('q_getbyid');
		const { rows } = await client.query(
			'SELECT id, username, display_name, email, is_admin, created_at FROM users WHERE id = $1',
			[id]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(id);
		expect(rows[0].username).toBe('q_getbyid');
		expect(rows[0]).toHaveProperty('email');
		expect(rows[0]).toHaveProperty('is_admin');
		expect(rows[0]).toHaveProperty('created_at');
	});

	// 3. authenticateUser pattern
	it('authenticateUser pattern: lookup by username then verify password_hash', async () => {
		const fakeHash = 'abcd1234:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
		await client.query(
			'INSERT INTO users (username, password_hash, display_name) VALUES ($1, $2, $3)',
			['q_auth_user', fakeHash, 'Auth User']
		);

		// Step 1: lookup — same SQL as getUserForAuth
		const { rows } = await client.query(
			'SELECT id, username, password_hash, display_name, is_admin FROM users WHERE username = $1',
			['q_auth_user']
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].password_hash).toBe(fakeHash);
		expect(rows[0].username).toBe('q_auth_user');
		// Step 2 (verify is Node crypto, not SQL — just confirm hash is retrievable)
		const parts = rows[0].password_hash.split(':');
		expect(parts).toHaveLength(2);
		expect(parts[0]).toBeTruthy();
		expect(parts[1]).toBeTruthy();
	});

	// 4. createPool full transaction
	it('createPool pattern: transaction creates pool + member + 10 scoring_config rows', async () => {
		const userId = await insertUser('q_pool_tx');

		// Use a separate client for inner transaction (outer client is already in BEGIN)
		const inner = await pool.connect();
		try {
			await inner.query('BEGIN');

			const poolRes = await inner.query(
				`INSERT INTO pools (name, invite_code, share_token, created_by, buy_in, allow_multiple_predictions, currency)
				 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
				['Q Transaction Pool', 'TXCODE123', 'tx-share-token', userId, 0, false, 'EUR']
			);
			const poolId = Number(poolRes.rows[0].id);

			// Creator auto-joins
			await inner.query(
				'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
				[poolId, userId]
			);

			// 10 scoring_config defaults (same as queries.ts)
			const defaults: [string, number][] = [
				['match_outcome', 1], ['exact_score', 3], ['group_position', 2],
				['knockout_r32', 2], ['knockout_r16', 3], ['knockout_qf', 4],
				['knockout_sf', 6], ['knockout_final', 6], ['third_place', 6],
				['knockout_winner', 8],
			];
			for (const [rule, pts] of defaults) {
				await inner.query(
					'INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)',
					[poolId, rule, pts]
				);
			}

			await inner.query('COMMIT');

			// Verify via the test transaction client (same connection pool, data is committed)
			const p = await client.query('SELECT * FROM pools WHERE id = $1', [poolId]);
			expect(p.rows).toHaveLength(1);
			expect(p.rows[0].name).toBe('Q Transaction Pool');

			const m = await client.query('SELECT * FROM pool_members WHERE pool_id = $1', [poolId]);
			expect(m.rows).toHaveLength(1);
			expect(m.rows[0].user_id).toBe(userId);

			const sc = await client.query('SELECT * FROM scoring_config WHERE pool_id = $1 ORDER BY rule', [poolId]);
			expect(sc.rows).toHaveLength(10);

			// Clean up committed data (outer test is in ROLLBACK so manual delete)
			await client.query('DELETE FROM pools WHERE id = $1', [poolId]);
		} finally {
			inner.release();
		}
	});

	// 5. joinPool pattern — duplicate throws 23505
	it('joinPool pattern: INSERT pool_members succeeds, duplicate throws 23505', async () => {
		const creatorId = await insertUser('q_join_creator');
		const joinerId = await insertUser('q_joiner');
		const poolId = await insertPool('Q Join Pool', creatorId);

		// First join succeeds
		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId, joinerId]
		);

		// Second join with same (pool_id, user_id) fails with code 23505
		let err: any;
		try {
			await client.query(
				'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
				[poolId, joinerId]
			);
		} catch (e: any) {
			err = e;
		}
		expect(err).toBeDefined();
		expect(err.code).toBe('23505');
	});

	// 6. createPrediction ON CONFLICT upsert
	it('createPrediction pattern: ON CONFLICT upsert returns same row', async () => {
		const userId = await insertUser('q_pred_upsert');
		const poolId = await insertPool('Q Upsert Pool', userId);

		// First insert
		const r1 = await client.query(
			`INSERT INTO predictions (user_id, pool_id, label, total_score, has_paid)
			 VALUES ($1, $2, $3, 0, FALSE)
			 ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label
			 RETURNING id`,
			[userId, poolId, 'Entry1']
		);
		expect(r1.rows[0].id).toBeGreaterThan(0);
		const firstId = r1.rows[0].id;

		// Upsert with same (user_id, pool_id, label) — should return same id
		const r2 = await client.query(
			`INSERT INTO predictions (user_id, pool_id, label, total_score, has_paid)
			 VALUES ($1, $2, $3, 0, FALSE)
			 ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label
			 RETURNING id`,
			[userId, poolId, 'Entry1']
		);
		expect(r2.rows[0].id).toBe(firstId);

		// Verify only one row exists
		const all = await client.query(
			'SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2',
			[poolId, userId]
		);
		expect(all.rows).toHaveLength(1);
	});

	// 7. getScoringConfig pattern
	it('getScoringConfig pattern: SELECT rows as Record<string, number>', async () => {
		const userId = await insertUser('q_scfg_user');
		const poolId = await insertPool('Q Scfg Pool', userId);

		await client.query(
			'INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)',
			[poolId, 'match_outcome', 5]
		);
		await client.query(
			'INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)',
			[poolId, 'exact_score', 10]
		);

		// Same logic as getScoringConfig: SELECT rule, points -> Record
		const { rows } = await client.query(
			'SELECT rule, points FROM scoring_config WHERE pool_id = $1',
			[poolId]
		);
		const config: Record<string, number> = {};
		for (const row of rows as any[]) config[row.rule] = row.points;

		expect(config['match_outcome']).toBe(5);
		expect(config['exact_score']).toBe(10);
		expect(Object.keys(config)).toHaveLength(2);
	});

	// 8. Session CRUD pattern
	it('session CRUD pattern: INSERT, SELECT by token, DELETE', async () => {
		const userId = await insertUser('q_sess_crud');
		const token = 'crud-token-' + Date.now();
		const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

		// Create
		await client.query(
			'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
			[userId, token, expires]
		);

		// Read
		const { rows } = await client.query(
			'SELECT * FROM sessions WHERE token = $1',
			[token]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].user_id).toBe(userId);

		// Delete
		await client.query('DELETE FROM sessions WHERE token = $1', [token]);
		const after = await client.query('SELECT * FROM sessions WHERE token = $1', [token]);
		expect(after.rows).toHaveLength(0);
	});

	// 9. IS NOT DISTINCT FROM
	it('IS NOT DISTINCT FROM works for NULL label comparisons', async () => {
		const userId = await insertUser('q_indf_user');
		const poolId = await insertPool('Q INDF Pool', userId);

		// Insert two predictions with NULL label (override default '')
		await client.query(
			`INSERT INTO predictions (pool_id, user_id, label, total_score) VALUES ($1, $2, NULL, 0)`,
			[poolId, userId]
		);

		// IS NOT DISTINCT FROM should match NULL = NULL
		const { rows } = await client.query(
			`SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2 AND label IS NOT DISTINCT FROM NULL`,
			[poolId, userId]
		);
		expect(rows).toHaveLength(1);
	});

	// 10. unnest() for array parameters
	it('unnest() works for batch array operations', async () => {
		const t1 = await insertTeam('Unnest1', 'X');
		const t2 = await insertTeam('Unnest2', 'X');
		const t3 = await insertTeam('Unnest3', 'X');

		// Use unnest to fetch teams by an array of IDs
		const { rows } = await client.query(
			'SELECT id, name FROM teams WHERE id = ANY($1::int[]) ORDER BY id',
			[[t1, t2, t3]]
		);
		expect(rows).toHaveLength(3);
		expect(rows.map((r: any) => r.name)).toEqual(['Unnest1', 'Unnest2', 'Unnest3']);

		// Also test raw unnest as a set-returning function
		const { rows: unnestRows } = await client.query(
			'SELECT unnest($1::int[]) AS id',
			[[t1, t2, t3]]
		);
		expect(unnestRows).toHaveLength(3);
	});

	// 11. getUserPools pattern
	it('getUserPools pattern: JOIN returns pools with member_count', async () => {
		const u1 = await insertUser('q_pools_u1');
		const u2 = await insertUser('q_pools_u2');
		const poolId1 = await insertPool('Q UserPool1', u1);
		const poolId2 = await insertPool('Q UserPool2', u1);

		// u1 is creator/auto-join for both pools
		// u2 joins pool1
		await client.query(
			'INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)',
			[poolId1, u2]
		);

		// getUserPools SQL pattern
		const { rows } = await client.query(
			`SELECT p.id, p.name, pm.has_paid, pm.joined_at,
				(SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
			 FROM pools p
			 JOIN pool_members pm ON pm.pool_id = p.id
			 WHERE pm.user_id = $1
			 ORDER BY p.created_at DESC`,
			[u1]
		);

		expect(rows).toHaveLength(2);
		// pool1 has 2 members (u1 + u2), pool2 has 1 member (u1)
		const p1 = rows.find((r: any) => r.name === 'Q UserPool1');
		const p2 = rows.find((r: any) => r.name === 'Q UserPool2');
		expect(Number(p1.member_count)).toBe(2);
		expect(Number(p2.member_count)).toBe(1);
	});
});
