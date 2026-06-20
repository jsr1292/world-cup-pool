import { getPoolById, getScoringConfig } from './queries.js';
import { query } from './db.js';
import { getTeamsMapCached } from './cache.js';
import { DEFAULT_SCORING_RULES } from './scoring.js';

// Raw inputs for the "what-if" standings simulator. The projection is computed
// live on the client. Gated to fully locked pools (exposes everyone's picks,
// same rule as stats / viewing bets). Shared by the standalone route loader and
// the /api/pools/[id]/simulator endpoint (used by the inline tab).
export async function getSimulatorData(
  poolId: number, userId: number
): Promise<{ error: string; status: number } | Record<string, any>> {
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) return { error: 'Quiniela no encontrada', status: 404 };
  const pool = await getPoolById(poolId) as any;
  if (!pool) return { error: 'Quiniela no encontrada', status: 404 };

  const { rows: gate } = await query('SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, userId]);
  if (gate.length === 0 && pool.created_by !== userId) return { error: 'No eres miembro de esta quiniela', status: 403 };

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;
  const safePool = { id: pool.id, name: pool.name, allow_multiple_predictions: pool.allow_multiple_predictions };

  if (!betsLocked) {
    return { pool: safePool, betsLocked: false, teams: {}, entries: [], matches: [], picks: {}, orders: {}, matchOutcomePts: 0, groupPositionPts: 0, userId };
  }

  const scoring = { ...DEFAULT_SCORING_RULES, ...(await getScoringConfig(poolId)) };
  const matchOutcomePts = Number(scoring.match_outcome) || 0;
  const groupPositionPts = Number(scoring.group_position) || 0;

  const teams = await getTeamsMapCached();

  const { rows: entriesRaw } = await query(
    `SELECT p.id, p.user_id, u.display_name, p.label, p.total_score
     FROM predictions p JOIN users u ON u.id = p.user_id
     WHERE p.pool_id = $1 ORDER BY p.total_score DESC, u.display_name`, [poolId]
  );
  const entries = entriesRaw.map((e: any) => ({
    id: Number(e.id), user_id: Number(e.user_id), display_name: e.display_name,
    label: e.label || null, total_score: Number(e.total_score) || 0,
  }));

  const { rows: matchesRaw } = await query(
    `SELECT id, group_name, home_team_id, away_team_id, kickoff_time, status, home_score, away_score, sort_order
     FROM matches WHERE phase = 'group'
     ORDER BY kickoff_time NULLS LAST, sort_order`
  );
  const matches = matchesRaw.map((m: any) => ({
    id: Number(m.id), group_name: m.group_name,
    home_team_id: m.home_team_id, away_team_id: m.away_team_id,
    kickoff_time: m.kickoff_time instanceof Date ? m.kickoff_time.toISOString() : (m.kickoff_time ? String(m.kickoff_time) : null),
    status: m.status, home_score: m.home_score, away_score: m.away_score,
  }));

  const { rows: mpRows } = await query(
    `SELECT mp.prediction_id AS pid, mp.match_id AS mid, mp.home_score AS ph, mp.away_score AS pa
     FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id
     JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
     WHERE p.pool_id = $1 AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL`, [poolId]
  );
  const picks: Record<number, Record<number, string>> = {};
  for (const r of mpRows) { (picks[r.pid] ??= {})[r.mid] = r.ph > r.pa ? '1' : r.ph < r.pa ? '2' : 'X'; }

  const orders: Record<number, Record<string, number[]>> = {};
  if (groupPositionPts > 0) {
    const { rows: gpRows } = await query(
      `SELECT gp.prediction_id AS pid, gp.group_name AS g, gp.position_1 AS p1, gp.position_2 AS p2, gp.position_3 AS p3, gp.position_4 AS p4
       FROM group_predictions gp JOIN predictions p ON p.id = gp.prediction_id
       WHERE p.pool_id = $1`, [poolId]
    );
    for (const r of gpRows) { (orders[r.pid] ??= {})[r.g] = [r.p1, r.p2, r.p3, r.p4]; }
  }

  return { pool: safePool, betsLocked: true, teams, entries, matches, picks, orders, matchOutcomePts, groupPositionPts, userId };
}
