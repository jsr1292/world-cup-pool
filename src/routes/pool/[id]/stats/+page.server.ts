import { getPoolById } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

// Aggregate "what did everyone vote" stats for a pool. Gated to FULLY LOCKED
// pools (both deadlines passed) so the consensus can't be copied before bets
// close — same rule as viewing another member's bets.
export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');

  const poolId = Number(params.id);
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) throw error(404, 'Quiniela no encontrada');
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;

  const safePool = { id: pool.id, name: pool.name };

  if (!betsLocked) {
    return { pool: safePool, betsLocked: false, totalEntries: 0, teams: {}, champions: [], finalists: [], groupWinners: {} };
  }

  const teams = await getTeamsMapCached();

  // Denominator: how many entries exist in this pool.
  const totalEntries = Number((await query(
    'SELECT COUNT(*)::int AS c FROM predictions WHERE pool_id = $1', [poolId]
  )).rows[0].c);

  // Champion picks — the bracket's 'final' phase holds each entry's champion.
  const { rows: champions } = await query(`
    SELECT bp.team_id, COUNT(*)::int AS c
    FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
    WHERE p.pool_id = $1 AND bp.phase = 'final' AND bp.team_id IS NOT NULL
    GROUP BY bp.team_id ORDER BY c DESC, bp.team_id`, [poolId]);

  // Finalists — the two 'sf' winners each entry sent to the final.
  const { rows: finalists } = await query(`
    SELECT bp.team_id, COUNT(*)::int AS c
    FROM bracket_predictions bp JOIN predictions p ON p.id = bp.prediction_id
    WHERE p.pool_id = $1 AND bp.phase = 'sf' AND bp.team_id IS NOT NULL
    GROUP BY bp.team_id ORDER BY c DESC, bp.team_id`, [poolId]);

  // Predicted winner of each group (position_1), grouped by group.
  const { rows: gwRows } = await query(`
    SELECT gp.group_name, gp.position_1 AS team_id, COUNT(*)::int AS c
    FROM group_predictions gp JOIN predictions p ON p.id = gp.prediction_id
    WHERE p.pool_id = $1 AND gp.position_1 IS NOT NULL
    GROUP BY gp.group_name, gp.position_1
    ORDER BY gp.group_name, c DESC, gp.position_1`, [poolId]);
  const groupWinners: Record<string, { team_id: number; c: number }[]> = {};
  for (const r of gwRows) {
    (groupWinners[r.group_name] ??= []).push({ team_id: r.team_id, c: r.c });
  }

  return {
    pool: safePool,
    betsLocked: true,
    totalEntries,
    teams,
    champions: champions as { team_id: number; c: number }[],
    finalists: finalists as { team_id: number; c: number }[],
    groupWinners,
  };
};
