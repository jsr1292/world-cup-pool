import { getPoolById, getUserPredictions } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import { getTeamsMapCached } from '$lib/server/cache.js';
import { isEmailConfigured } from '$lib/server/email.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  if (!locals.user) throw error(401, 'Inicia sesión');

  const poolId = Number(params.id);
  // Garbage ids ("abc", "1.5", "null") otherwise reach the SQL int cast and 500.
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) throw error(404, 'Quiniela no encontrada');
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // #3 — Membership/creator gate (mirror the sibling pool pages). Without it,
  // any authenticated user could load another pool's summary and read its
  // invite_code / share_token from the serialized page data.
  const { rows: gate } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [poolId, locals.user.id]
  );
  if (gate.length === 0 && pool.created_by !== locals.user.id) {
    throw error(403, 'No eres miembro de esta quiniela');
  }

  // #3 — Never serialize sensitive columns (invite_code, share_token) to the
  // client; return only the fields the page needs.
  const safePool = {
    id: pool.id,
    name: pool.name,
    buy_in: pool.buy_in,
    currency: pool.currency,
    is_active: pool.is_active,
    created_by: pool.created_by,
    allow_multiple_predictions: pool.allow_multiple_predictions,
    deadline_group: pool.deadline_group,
    deadline_knockout: pool.deadline_knockout,
  };

  // §6 — View another member's bets once the pool is FULLY locked (both
  // deadlines passed). Until then bets stay private. Gated to entries in THIS
  // pool (no cross-pool IDOR).
  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const betsLocked = !!dg && dg <= new Date() && !!dk && dk <= new Date();
  const viewRaw = url.searchParams.get('view');
  const viewId = viewRaw && /^\d+$/.test(viewRaw) ? Number(viewRaw) : null;

  let viewing: { owner: string; label: string | null } | null = null;
  let entries: any[];
  if (betsLocked && viewId) {
    const { rows: vrows } = await query(
      `SELECT p.id, p.label, p.total_score, u.display_name
       FROM predictions p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.pool_id = $2`,
      [viewId, poolId]
    );
    if (vrows.length > 0) {
      entries = [{ id: Number(vrows[0].id), label: vrows[0].label, total_score: vrows[0].total_score }];
      viewing = { owner: vrows[0].display_name, label: vrows[0].label || null };
    } else {
      entries = await getUserPredictions(poolId, locals.user.id) as any[];
    }
  } else {
    entries = await getUserPredictions(poolId, locals.user.id) as any[];
  }

  // H-04: Bulk-fetch teams and predictions (no N+1 loop)
  const teams = await getTeamsMapCached();

  const groupPreds: Record<number, any[]> = {};
  const bracketPreds: Record<number, any[]> = {};
  // Per-match 1/X/2 picks for the group games, so a member's Resumen shows who
  // they backed (win/draw/loss) on each match — not just their final-table order.
  const matchPreds: Record<number, any[]> = {};

  if (entries.length > 0) {
    const predIds = entries.map((e: any) => e.id);

    const { rows: allGP } = await query(`
      SELECT prediction_id, group_name, position_1, position_2, position_3, position_4
      FROM group_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY group_name
    `, [predIds]);
    for (const gp of allGP) {
      if (!groupPreds[gp.prediction_id]) groupPreds[gp.prediction_id] = [];
      groupPreds[gp.prediction_id].push(gp);
    }

    const { rows: allBP } = await query(`
      SELECT prediction_id, phase, slot as match_index, team_id
      FROM bracket_predictions WHERE prediction_id = ANY($1::int[])
      ORDER BY phase, slot
    `, [predIds]);
    for (const bp of allBP) {
      if (!bracketPreds[bp.prediction_id]) bracketPreds[bp.prediction_id] = [];
      bracketPreds[bp.prediction_id].push(bp);
    }

    // Per-match group picks joined to the match (teams + result + status), so
    // the view can show each 1/X/2 bet and mark it ✓/✗ once the game is played.
    const { rows: allMP } = await query(`
      SELECT mp.prediction_id, mp.match_id,
             mp.home_score AS pred_home, mp.away_score AS pred_away, mp.points_earned,
             m.group_name, m.home_team_id, m.away_team_id,
             m.home_score AS actual_home, m.away_score AS actual_away, m.status
      FROM match_predictions mp
      JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
      WHERE mp.prediction_id = ANY($1::int[])
      ORDER BY m.group_name, m.sort_order, m.kickoff_time
    `, [predIds]);
    for (const mp of allMP) {
      if (!matchPreds[mp.prediction_id]) matchPreds[mp.prediction_id] = [];
      matchPreds[mp.prediction_id].push(mp);
    }

    // Fill empty arrays for entries with no predictions
    for (const entry of entries) {
      if (!groupPreds[entry.id]) groupPreds[entry.id] = [];
      if (!bracketPreds[entry.id]) bracketPreds[entry.id] = [];
      if (!matchPreds[entry.id]) matchPreds[entry.id] = [];
    }
  }

  return {
    pool: safePool, entries, groupPreds, bracketPreds, matchPreds, teams,
    emailEnabled: isEmailConfigured() && !!locals.user.email,
    viewing,
  };
};
