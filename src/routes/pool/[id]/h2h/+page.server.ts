import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

// Head-to-head: compare two entries' predictions side by side. Gated to fully
// locked pools (same rule as viewing bets / stats).
export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');

  const poolId = Number(params.id);
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) throw error(404, 'Quiniela no encontrada');
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) throw error(403, 'No eres miembro de esta quiniela');

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;
  const safePool = { id: pool.id, name: pool.name, allow_multiple_predictions: pool.allow_multiple_predictions };

  if (!betsLocked) return { pool: safePool, betsLocked: false, entries: [], a: null, b: null, teams: {} };

  const { rows: entries } = await query(
    `SELECT p.id, u.display_name, p.label FROM predictions p JOIN users u ON u.id = p.user_id
     WHERE p.pool_id = $1 ORDER BY u.display_name, p.id`, [poolId]
  );
  const ids = new Set(entries.map((e: any) => Number(e.id)));

  const mine = await getUserPredictions(poolId, locals.user.id) as any[];
  const aId = pickId(url.searchParams.get('a'), ids) ?? (mine[0] ? Number(mine[0].id) : null);
  const bId = pickId(url.searchParams.get('b'), ids);

  const teams = await getTeamsMapCached();
  const a = aId ? await sideFor(aId, entries) : null;
  const b = bId ? await sideFor(bId, entries) : null;

  return { pool: safePool, betsLocked: true, entries, a, b, teams };
};

function pickId(raw: string | null, ids: Set<number>): number | null {
  const n = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  return n && ids.has(n) ? n : null;
}

async function sideFor(pid: number, entries: any[]) {
  const meta = entries.find((e) => Number(e.id) === pid);
  const champion = (await query(
    `SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = 'final' AND team_id IS NOT NULL LIMIT 1`, [pid]
  )).rows[0]?.team_id ?? null;
  const finalists = (await query(
    `SELECT team_id FROM bracket_predictions WHERE prediction_id = $1 AND phase = 'sf' AND team_id IS NOT NULL ORDER BY slot`, [pid]
  )).rows.map((r: any) => r.team_id);
  const gw: Record<string, number> = {};
  for (const r of (await query(
    `SELECT group_name, position_1 FROM group_predictions WHERE prediction_id = $1 AND position_1 IS NOT NULL`, [pid]
  )).rows) gw[r.group_name] = r.position_1;
  const tb = (await query('SELECT home_score, away_score FROM tiebreaker WHERE prediction_id = $1', [pid])).rows[0] ?? null;
  return {
    id: pid,
    owner: meta?.display_name ?? '?',
    label: meta?.label || null,
    champion, finalists, groupWinners: gw,
    tiebreaker: tb ? { home: tb.home_score, away: tb.away_score } : null,
  };
}
