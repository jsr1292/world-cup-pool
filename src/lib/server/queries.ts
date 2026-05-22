import { query, getClient } from './db.js';
import { invalidateCachedSession, getAllTeamsCached } from './cache.js';
import type { User, Pool, Prediction, GroupPrediction } from './types.js';
import crypto from 'crypto';

export async function hashPwd(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived: Buffer = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
  });
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPwd(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Malformed password hash: missing salt/hash separator');
  }
  const [salt, hash] = parts;
  const derived: Buffer = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(key));
  });
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived);
}

// Generate unique invite codes
export function generateInviteCode(): string {
  return crypto.randomBytes(16).toString('base64url').slice(0, 16).toUpperCase();
}

// Session tokens
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// User CRUD
export async function createUser(username: string, password: string, displayName: string, email?: string) {
  const hash = await hashPwd(password);
  const result = await query(
    'INSERT INTO users (username, password_hash, display_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, hash, displayName, email ?? null]
  );
  return result;
}

export async function getUserById(id: number): Promise<User | null> {
  const { rows } = await query('SELECT id, username, display_name, email, is_admin, created_at FROM users WHERE id = $1', [id]);
  return (rows[0] as User) ?? null;
}

export async function getUserForAuth(username: string): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await query('SELECT id, username, password_hash, display_name, is_admin FROM users WHERE username = $1', [username]);
  return (rows[0] as (User & { password_hash: string })) ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { rows } = await query('SELECT id, username, display_name, is_admin, created_at FROM users WHERE username = $1', [username]);
  return (rows[0] as User) ?? null;
}

export async function authenticateUser(username: string, password: string) {
  const user = await getUserForAuth(username);
  if (!user) return null;
  if (!await verifyPwd(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin };
}

// Pool CRUD
export async function createPool(name: string, createdBy: number, buyIn = 0, allowMultiple = false, currency = 'EUR') {
  const inviteCode = generateInviteCode();

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO pools (name, invite_code, created_by, buy_in, allow_multiple_predictions, currency)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [name, inviteCode, createdBy, buyIn, allowMultiple, currency]
    );
    const poolId = Number(insertResult.rows[0].id);

    // Creator auto-joins
    await client.query('INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)', [poolId, createdBy]);

    // Default scoring config
    const defaults = [
      ['match_outcome', 1],
      ['exact_score', 3],
      ['group_position', 2],
      ['knockout_r32', 2],
      ['knockout_r16', 3],
      ['knockout_qf', 4],
      ['knockout_sf', 6],
      ['knockout_final', 6],
      ['third_place', 6],
      ['knockout_winner', 8],
    ];
    for (const [rule, pts] of defaults) {
      await client.query('INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)', [poolId, rule, pts]);
    }

    await client.query('COMMIT');
    return { id: poolId, inviteCode };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function getPoolByInvite(code: string): Promise<Pool | null> {
  const { rows } = await query('SELECT * FROM pools WHERE invite_code = $1', [code]);
  return (rows[0] as Pool) ?? null;
}

export async function getPoolById(id: number): Promise<Pool | null> {
  const { rows } = await query('SELECT * FROM pools WHERE id = $1', [id]);
  return (rows[0] as Pool) ?? null;
}

export async function getUserPools(userId: number) {
  const { rows } = await query(
    `SELECT p.*, pm.has_paid, pm.joined_at,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id
    WHERE pm.user_id = $1
    ORDER BY p.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function joinPool(poolId: number, userId: number) {
  try {
    await query('INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)', [poolId, userId]);
    return true;
  } catch (e: any) {
    if (e.code === '23505') return false; // already joined
    throw e;
  }
}

export async function markPaid(poolId: number, userId: number) {
  await query('UPDATE pool_members SET has_paid = TRUE WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
}

export async function getPoolMembers(poolId: number) {
  // Return all pool members + their prediction entries (one row per entry if exists)
  // Members without predictions still show (just no entry_id)
  const { rows } = await query(
    `SELECT u.id as od_user_id, u.username, u.display_name,
      pr.id as entry_id, pr.label as entry_label, pr.total_score,
      COALESCE(pr.has_paid, pm.has_paid, FALSE) as has_paid,
      pm.joined_at
    FROM pool_members pm
    JOIN users u ON u.id = pm.user_id
    LEFT JOIN predictions pr ON pr.pool_id = pm.pool_id AND pr.user_id = pm.user_id
    WHERE pm.pool_id = $1
    ORDER BY u.display_name, pr.created_at`,
    [poolId]
  );
  return rows;
}

// Predictions
export async function createPrediction(poolId: number, userId: number, label = '') {
  const { rows } = await query(
    `INSERT INTO predictions (user_id, pool_id, label, total_score) VALUES ($1, $2, $3, 0) ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
    [userId, poolId, label]
  );
  return { rows };
}

export async function getUserPredictions(poolId: number, userId: number): Promise<Prediction[]> {
  const { rows } = await query('SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
  return rows as Prediction[];
}

export async function getPoolLeaderboard(poolId: number) {
  const { rows } = await query(
    `SELECT p.*, u.display_name, u.username,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.pool_id) as pool_size
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    WHERE p.pool_id = $1
    ORDER BY p.total_score DESC, p.updated_at ASC`,
    [poolId]
  );
  return rows;
}

// Scoring config
export async function getScoringConfig(poolId: number) {
  const { rows } = await query('SELECT rule, points FROM scoring_config WHERE pool_id = $1', [poolId]);
  const config: Record<string, number> = {};
  for (const row of rows as any[]) config[row.rule] = row.points;
  return config;
}

// Sessions
export async function createSession(userId: number): Promise<string> {
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  await query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)', [userId, token, expires]);
  return token;
}

export async function deleteSession(token: string) {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
  invalidateCachedSession(token);
}

export async function cleanSessions() {
  await query("DELETE FROM sessions WHERE expires_at < NOW()");
}

// Teams
export function getAllTeams() {
  return getAllTeamsCached();
}

export async function getGroupPredictions(predictionId: number): Promise<GroupPrediction[]> {
  const { rows } = await query(
    `SELECT group_name, position_1, position_2, position_3, position_4
    FROM group_predictions
    WHERE prediction_id = $1`,
    [predictionId]
  );
  return rows as GroupPrediction[];
}
