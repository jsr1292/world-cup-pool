import { query } from '$lib/server/db.js';
import { getPoolById, getPoolMembers, getPoolEntries, getScoringConfig } from '$lib/server/queries.js';
import { DEFAULT_SCORING_RULES } from '$lib/server/scoring.js';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ params, locals }) => {
  if (!locals.user) throw error(401, 'No autorizado');

  const poolId = Number(params.id);
  const pool = await getPoolById(poolId) as any;
  if (!pool) throw error(404, 'Quiniela no encontrada');

  // §4.6 — Match /api/admin/payment behaviour: creator OR site admin.
  if (pool.created_by !== locals.user.id && !locals.user.is_admin) {
    throw error(403, 'Solo el creador o un administrador del sitio pueden acceder');
  }

  const members = await getPoolMembers(poolId);   // one row per user
  const entries = await getPoolEntries(poolId);   // one row per (user, entry)
  // Merge defaults so newly-added rules (e.g. goal_difference) are editable
  // even for pools created before they existed; saved values override defaults.
  const scoring = { ...DEFAULT_SCORING_RULES, ...(await getScoringConfig(poolId)) };

  // Get ALL matches (group + knockout). Knockout matches start with NULL teams
  // until the admin assigns them, so the admin UI needs every phase plus the
  // full team list to populate the knockout team selectors.
  const { rows: matches } = await query(`
    SELECT m.*, t1.name as home_name, t1.flag_code as home_flag,
           t2.name as away_name, t2.flag_code as away_flag
    FROM matches m
    LEFT JOIN teams t1 ON t1.id = m.home_team_id
    LEFT JOIN teams t2 ON t2.id = m.away_team_id
    ORDER BY m.sort_order, m.kickoff_time
  `);

  // Full team list for the knockout team dropdowns (teams aren't known per
  // knockout match until the bracket resolves, so the admin picks them).
  const { rows: teams } = await query(
    'SELECT id, name, flag_code FROM teams ORDER BY name'
  );

  // Stats
  const { rows: tpRows } = await query('SELECT COUNT(*) as c FROM predictions WHERE pool_id = $1', [poolId]);
  const { rows: tmRows } = await query("SELECT COUNT(*) as c FROM matches WHERE phase = 'group'");
  const { rows: fmRows } = await query("SELECT COUNT(*) as c FROM matches WHERE phase = 'group' AND status = 'finished'");

  const stats = {
    totalMembers: members.length,                 // §3.11 — true member count
    totalEntries: entries.length,                 // §3.11 — entry count
    totalPaid: (members as any[]).filter(m => m.has_paid).length,
    totalPredictions: tpRows[0].c,
    totalMatches: tmRows[0].c,
    finishedMatches: fmRows[0].c,
  };

  // Completion status per entry — so the admin can see who has finished all
  // their predictions and who's missing something (groups / bracket / final).
  const completion: Record<number, { groups: number; groupsTotal: number; bracketDone: boolean; tiebreakerDone: boolean; complete: boolean }> = {};
  const entryIds = (entries as any[]).map(e => e.entry_id).filter((id): id is number => id != null);
  if (entryIds.length > 0) {
    const { rows: gmc } = await query(
      `SELECT mp.prediction_id, COUNT(*)::int AS c
       FROM match_predictions mp JOIN matches m ON m.id = mp.match_id AND m.phase = 'group'
       WHERE mp.prediction_id = ANY($1::int[]) GROUP BY mp.prediction_id`, [entryIds]);
    const groupCount: Record<number, number> = {};
    gmc.forEach((r: any) => { groupCount[r.prediction_id] = Number(r.c); });
    const { rows: fin } = await query(
      `SELECT prediction_id, COUNT(*)::int AS c FROM bracket_predictions
       WHERE prediction_id = ANY($1::int[]) AND phase = 'final' GROUP BY prediction_id`, [entryIds]);
    const finalCount: Record<number, number> = {};
    fin.forEach((r: any) => { finalCount[r.prediction_id] = Number(r.c); });
    const { rows: tb } = await query(
      `SELECT prediction_id FROM tiebreaker WHERE prediction_id = ANY($1::int[])`, [entryIds]);
    const tbSet = new Set(tb.map((r: any) => r.prediction_id));
    for (const id of entryIds) {
      const groups = groupCount[id] ?? 0;
      const bracketDone = (finalCount[id] ?? 0) >= 2;
      const tiebreakerDone = tbSet.has(id);
      completion[id] = { groups, groupsTotal: 72, bracketDone, tiebreakerDone, complete: groups >= 72 && bracketDone && tiebreakerDone };
    }
  }

  // Match results are GLOBAL (one matches table scores every pool), so only a
  // site admin enters them — /api/admin/results enforces this. Expose the flag
  // so the UI shows the results-entry section only to site admins (a non-admin
  // pool creator would otherwise see controls that 403 on save).
  const isSiteAdmin = !!locals.user.is_admin;

  return { pool, members, entries, scoring, matches, teams, stats, isSiteAdmin, completion };
};
