import { db } from './db.js';
import crypto from 'crypto';

export function hashPwd(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPwd(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  const verify = crypto.scryptSync(password, salt, 32).toString('hex');
  return hash === verify;
}

// Generate unique invite codes
export function generateInviteCode(): string {
  return crypto.randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

// Session tokens
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// User CRUD
export function createUser(username: string, password: string, displayName: string, email?: string) {
  const hash = hashPwd(password);
  const stmt = db.prepare('INSERT INTO users (username, password_hash, display_name, email) VALUES (?, ?, ?, ?)');
  return stmt.run(username, hash, displayName, email ?? null);
}

export function getUserById(id: number) {
  return db.prepare('SELECT id, username, display_name, email, is_admin, created_at FROM users WHERE id = ?').get(id);
}

export function getUserByUsername(username: string) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
}

export function authenticateUser(username: string, password: string) {
  const user = getUserByUsername(username);
  if (!user) return null;
  if (!verifyPwd(password, user.password_hash)) return null;
  return { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin };
}

// Pool CRUD
export function createPool(name: string, createdBy: number, buyIn = 0, currency = 'EUR') {
  const inviteCode = generateInviteCode();
  const stmt = db.prepare(`
    INSERT INTO pools (name, invite_code, created_by, buy_in, currency)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(name, inviteCode, createdBy, buyIn, currency);

  // Creator auto-joins
  db.prepare('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)').run(Number(result.lastInsertRowid), createdBy);

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
    ['knockout_winner', 8],
    ['final_exact_score', 5],
  ];
  const insertConfig = db.prepare('INSERT INTO scoring_config (pool_id, rule, points) VALUES (?, ?, ?)');
  for (const [rule, pts] of defaults) {
    insertConfig.run(Number(result.lastInsertRowid), rule, pts);
  }

  return { id: result.lastInsertRowid, inviteCode };
}

export function getPoolByInvite(code: string) {
  return db.prepare('SELECT * FROM pools WHERE invite_code = ?').get(code);
}

export function getPoolById(id: number) {
  return db.prepare('SELECT * FROM pools WHERE id = ?').get(id);
}

export function getUserPools(userId: number) {
  return db.prepare(`
    SELECT p.*, pm.has_paid, pm.joined_at,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.id) as member_count
    FROM pools p
    JOIN pool_members pm ON pm.pool_id = p.id
    WHERE pm.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);
}

export function joinPool(poolId: number, userId: number) {
  try {
    db.prepare('INSERT INTO pool_members (pool_id, user_id) VALUES (?, ?)').run(poolId, userId);
    return true;
  } catch (e: any) {
    if (e.code?.startsWith('SQLITE_CONSTRAINT')) return false; // already joined
    throw e;
  }
}

export function markPaid(poolId: number, userId: number) {
  db.prepare('UPDATE pool_members SET has_paid = 1 WHERE pool_id = ? AND user_id = ?').run(poolId, userId);
}

export function getPoolMembers(poolId: number) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, pm.has_paid, pm.joined_at
    FROM pool_members pm
    JOIN users u ON u.id = pm.user_id
    WHERE pm.pool_id = ?
    ORDER BY u.display_name
  `).all(poolId);
}

// Predictions
export function createPrediction(poolId: number, userId: number, label = '') {
  try {
    const stmt = db.prepare('INSERT INTO predictions (pool_id, user_id, label) VALUES (?, ?, ?)');
    return stmt.run(poolId, userId, label);
  } catch (e: any) {
    if (e.code === 'SQLITE_CONSTRAINT') return null; // duplicate
    throw e;
  }
}

export function getUserPredictions(poolId: number, userId: number) {
  return db.prepare('SELECT * FROM predictions WHERE pool_id = ? AND user_id = ?').all(poolId, userId);
}

export function getPoolLeaderboard(poolId: number) {
  return db.prepare(`
    SELECT p.*, u.display_name, u.username,
      (SELECT COUNT(*) FROM pool_members WHERE pool_id = p.pool_id) as pool_size
    FROM predictions p
    JOIN users u ON u.id = p.user_id
    WHERE p.pool_id = ?
    ORDER BY p.total_score DESC, p.updated_at ASC
  `).all(poolId);
}

// Scoring config
export function getScoringConfig(poolId: number) {
  const rows = db.prepare('SELECT rule, points FROM scoring_config WHERE pool_id = ?').all(poolId) as any[];
  const config: Record<string, number> = {};
  for (const row of rows) config[row.rule] = row.points;
  return config;
}

// Sessions
export function createSession(userId: number): string {
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days
  db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(userId, token, expires);
  return token;
}

export function deleteSession(token: string) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

// Teams
export function getAllTeams() {
  return db.prepare('SELECT * FROM teams ORDER BY group_name, fifa_rank').all();
}

export function getGroupPredictions(predictionId: number) {
  return db.prepare(`
    SELECT group_name, position_1, position_2, position_3, position_4
    FROM group_predictions
    WHERE prediction_id = ?
  `).all(predictionId) as any[];
}
