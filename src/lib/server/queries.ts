import { query, getClient } from './db.js';
import { invalidateCachedSession, getAllTeamsCached } from './cache.js';
import { DEFAULT_SCORING_RULES } from './scoring.js';
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

// §3.12 — base64url-uppercase collapses the 64-char alphabet to ~38 distinct
// characters (digits + uppercase letters + '-' '_'). 16 chars at ~38 distinct
// values is ~84 bits — fine today but at the low end. Bump the length to 24
// (≈ 126 bits after the uppercase squashing) so codes survive any future
// public-facing enumeration scan.
export function generateInviteCode(): string {
  return crypto.randomBytes(24).toString('base64url').slice(0, 24).toUpperCase();
}

// Session tokens
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// User CRUD

/** Normalize an email for storage/lookup (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Derive a safe public @handle (username) from an email's local part. The
 *  handle is shown to other members; the email is NEVER exposed to clients. */
function deriveHandle(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  let h = local.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16);
  if (h.length < 3) h = `user${h}`;
  return h.slice(0, 20);
}

/**
 * Create a user from an email (the login identifier). A unique public handle
 * is derived from the email; the raw email is stored lowercased and unique.
 * Throws an Error with code 'EMAIL_TAKEN' if the email already exists.
 */
export async function createUser(email: string, password: string, displayName: string) {
  const normEmail = normalizeEmail(email);
  const hash = await hashPwd(password);
  const base = deriveHandle(normEmail);

  // Retry a few times to resolve handle collisions (email collisions are fatal).
  for (let attempt = 0; attempt < 6; attempt++) {
    const username = attempt === 0 ? base : `${base.slice(0, 14)}_${crypto.randomBytes(2).toString('hex')}`;
    try {
      const result = await query(
        'INSERT INTO users (username, password_hash, display_name, email) VALUES ($1, $2, $3, $4) RETURNING id',
        [username, hash, displayName, normEmail]
      );
      return result;
    } catch (e: any) {
      // 23505 = unique_violation. Distinguish email vs username collision.
      if (e?.code === '23505') {
        const detail = String(e.detail ?? '') + String(e.constraint ?? '');
        if (detail.includes('email')) {
          const err = new Error('Email already registered');
          (err as any).code = 'EMAIL_TAKEN';
          throw err;
        }
        // username collision → try another handle
        continue;
      }
      throw e;
    }
  }
  const err = new Error('Could not allocate a unique handle');
  (err as any).code = 'HANDLE_EXHAUSTED';
  throw err;
}

export async function getUserById(id: number): Promise<User | null> {
  const { rows } = await query('SELECT id, username, display_name, email, is_admin, created_at FROM users WHERE id = $1', [id]);
  return (rows[0] as User) ?? null;
}

export async function getUserForAuth(email: string): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await query(
    'SELECT id, username, password_hash, display_name, is_admin FROM users WHERE lower(email) = lower($1)',
    [normalizeEmail(email)]
  );
  return (rows[0] as (User & { password_hash: string })) ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const { rows } = await query('SELECT id, username, display_name, is_admin, created_at FROM users WHERE username = $1', [username]);
  return (rows[0] as User) ?? null;
}

/** Authenticate by EMAIL + password. */
export async function authenticateUser(email: string, password: string) {
  const user = await getUserForAuth(email);
  if (!user) return null;
  if (!await verifyPwd(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin };
}

// ── Password reset tokens ───────────────────────────────────────────────────

function hashResetToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/** Look up a user id by email (for the forgot-password flow). */
export async function getUserIdByEmail(email: string): Promise<number | null> {
  const { rows } = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [normalizeEmail(email)]);
  return rows[0]?.id ?? null;
}

/** Create a single-use reset token (default 1-hour expiry). Returns the RAW
 *  token to embed in the emailed link; only its hash is stored. */
export async function createPasswordResetToken(userId: number, ttlMs = 60 * 60 * 1000): Promise<string> {
  const raw = generateToken();
  const tokenHash = hashResetToken(raw);
  const expires = new Date(Date.now() + ttlMs).toISOString();
  // Invalidate any prior outstanding tokens for this user.
  await query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
  await query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expires]
  );
  return raw;
}

/**
 * Atomically consume a reset token: returns the user_id if the token is valid
 * (exists, unused, unexpired) and marks it used; otherwise null.
 */
export async function consumePasswordResetToken(raw: string): Promise<number | null> {
  const tokenHash = hashResetToken(raw);
  const { rows } = await query(
    `UPDATE password_reset_tokens
       SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
    [tokenHash]
  );
  return rows[0]?.user_id ?? null;
}

/** Set a user's password and invalidate all of their sessions. */
export async function setUserPassword(userId: number, newPassword: string): Promise<void> {
  const hash = await hashPwd(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]);
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// Pool CRUD
export async function createPool(name: string, createdBy: number, buyIn = 0, allowMultiple = false, currency = 'EUR') {
  const inviteCode = generateInviteCode();
  const shareToken = crypto.randomUUID();

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const insertResult = await client.query(
      `INSERT INTO pools (name, invite_code, share_token, created_by, buy_in, allow_multiple_predictions, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [name, inviteCode, shareToken, createdBy, buyIn, allowMultiple, currency]
    );
    const poolId = Number(insertResult.rows[0].id);

    // Creator auto-joins
    await client.query('INSERT INTO pool_members (pool_id, user_id) VALUES ($1, $2)', [poolId, createdBy]);

    // Single-source default scoring config from scoring.ts
    for (const [rule, pts] of Object.entries(DEFAULT_SCORING_RULES)) {
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

export async function getPoolByShareToken(token: string): Promise<Pool | null> {
  const { rows } = await query('SELECT * FROM pools WHERE share_token = $1', [token]);
  return (rows[0] as Pool) ?? null;
}

export async function getPoolById(id: number): Promise<Pool | null> {
  const { rows } = await query('SELECT * FROM pools WHERE id = $1', [id]);
  return (rows[0] as Pool) ?? null;
}

export async function getUserPools(userId: number) {
  // §4.4 — Order by most-recent-joined so a user who joins many pools sees the
  // newest one at the top, regardless of when that pool was originally created.
  const { rows } = await query(
    `SELECT p.*, pm.has_paid, pm.joined_at,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id
    WHERE pm.user_id = $1
    ORDER BY pm.joined_at DESC, p.created_at DESC`,
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

// §3.11 — DISTINCT one row per member (used for "how many members in the
// pool" counts). For per-entry data (e.g. the admin list of paid/unpaid
// entries), call getPoolEntries() instead.
export async function getPoolMembers(poolId: number) {
  const { rows } = await query(
    `SELECT u.id as user_id, u.username, u.display_name,
      pm.has_paid, pm.joined_at
     FROM pool_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.pool_id = $1
     ORDER BY u.display_name`,
    [poolId]
  );
  return rows;
}

// §3.11 — One row per (member, prediction entry). Members with no entries are
// still listed (entry_id is NULL).
export async function getPoolEntries(poolId: number) {
  const { rows } = await query(
    `SELECT u.id as user_id, u.username, u.display_name,
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
  // Inherit has_paid from pool_members if already paid
  const { rows: memberRows } = await query(
    'SELECT has_paid FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, userId]
  );
  const hasPaid = memberRows[0]?.has_paid ?? false;
  const { rows } = await query(
    `INSERT INTO predictions (user_id, pool_id, label, total_score, has_paid) VALUES ($1, $2, $3, 0, $4) ON CONFLICT (user_id, pool_id, label) DO UPDATE SET label = EXCLUDED.label RETURNING id`,
    [userId, poolId, label, hasPaid]
  );
  return { rows };
}

export async function getUserPredictions(poolId: number, userId: number): Promise<Prediction[]> {
  // §3.3 — Sort by creation time so callers that use predictions[0] as the
  // "default entry" always get the same row across requests.
  const { rows } = await query(
    'SELECT * FROM predictions WHERE pool_id = $1 AND user_id = $2 ORDER BY created_at ASC, id ASC',
    [poolId, userId]
  );
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
