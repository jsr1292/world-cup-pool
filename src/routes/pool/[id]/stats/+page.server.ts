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
  const empty = {
    pool: safePool, betsLocked: false, totalEntries: 0, teams: {},
    champions: [], finalists: [], groupWinners: {}, divisive: [], mainstream: [], contrarian: [], matchBreakdown: [],
  };
  if (!betsLocked) return empty;

  const teams = await getTeamsMapCached();

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

  // Predicted winner of each group (position_1).
  const { rows: gwRows } = await query(`
    SELECT gp.group_name, gp.position_1 AS team_id, COUNT(*)::int AS c
    FROM group_predictions gp JOIN predictions p ON p.id = gp.prediction_id
    WHERE p.pool_id = $1 AND gp.position_1 IS NOT NULL
    GROUP BY gp.group_name, gp.position_1
    ORDER BY gp.group_name, c DESC, gp.position_1`, [poolId]);
  const groupWinners: Record<string, { team_id: number; c: number }[]> = {};
  for (const r of gwRows) (groupWinners[r.group_name] ??= []).push({ team_id: r.team_id, c: r.c });

  // Per-group-match 1/X/2 vote split → "most divisive", and the modal pick per
  // match (used below to score how "with the crowd" each entry is).
  const { rows: mv } = await query(`
    SELECT m.id, m.group_name, m.kickoff_time, m.sort_order,
      m.home_team_id, m.away_team_id, m.status, m.home_score, m.away_score,
      COUNT(*) FILTER (WHERE mp.home_score > mp.away_score)::int AS p1,
      COUNT(*) FILTER (WHERE mp.home_score = mp.away_score)::int AS px,
      COUNT(*) FILTER (WHERE mp.home_score < mp.away_score)::int AS p2
    FROM match_predictions mp
    JOIN predictions p ON p.id = mp.prediction_id
    JOIN matches m ON m.id = mp.match_id
    WHERE p.pool_id = $1 AND m.phase = 'group' AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL
    GROUP BY m.id`, [poolId]);

  const modal: Record<number, '1' | 'X' | '2'> = {};
  const divisiveAll = mv.map((r: any) => {
    const total = r.p1 + r.px + r.p2;
    const m: '1' | 'X' | '2' = r.p1 >= r.px && r.p1 >= r.p2 ? '1' : r.p2 >= r.px ? '2' : 'X';
    modal[r.id] = m;
    const top = Math.max(r.p1, r.px, r.p2);
    const split = total > 0 ? 1 - top / total : 0; // higher = more divided
    const actual = r.status === 'finished' && r.home_score != null
      ? (r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X') : null;
    return {
      id: r.id, home: r.home_team_id, away: r.away_team_id, p1: r.p1, px: r.px, p2: r.p2, total,
      split, finished: actual != null, actual,
    };
  }).filter((d) => d.total >= 2);
  const divisive = divisiveAll.sort((a, b) => b.split - a.split || b.total - a.total).slice(0, 5);

  // Full chronological breakdown: every group match with its 1/X/2 vote split
  // and (once played) the actual result, ordered by kickoff.
  const matchBreakdown = mv
    .map((r: any) => {
      const total = r.p1 + r.px + r.p2;
      const actual = r.status === 'finished' && r.home_score != null
        ? (r.home_score > r.away_score ? '1' : r.home_score < r.away_score ? '2' : 'X') : null;
      return {
        id: r.id, group_name: r.group_name, kickoff: r.kickoff_time,
        home: r.home_team_id, away: r.away_team_id,
        p1: r.p1, px: r.px, p2: r.p2, total,
        finished: actual != null, actual, home_score: r.home_score, away_score: r.away_score,
      };
    })
    .sort((a, b) => {
      const ak = a.kickoff ? new Date(a.kickoff).getTime() : Infinity;
      const bk = b.kickoff ? new Date(b.kickoff).getTime() : Infinity;
      return ak - bk;
    });

  // "With the crowd" — for each entry, the share of its group picks that matched
  // the pool's most-popular pick. Top = most mainstream, bottom = most contrarian.
  const { rows: picks } = await query(`
    SELECT mp.prediction_id AS pid, mp.match_id AS mid,
      CASE WHEN mp.home_score > mp.away_score THEN '1' WHEN mp.home_score < mp.away_score THEN '2' ELSE 'X' END AS o
    FROM match_predictions mp JOIN predictions p ON p.id = mp.prediction_id JOIN matches m ON m.id = mp.match_id
    WHERE p.pool_id = $1 AND m.phase = 'group' AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL`, [poolId]);
  const { rows: entryRows } = await query(
    `SELECT p.id, u.display_name, p.label FROM predictions p JOIN users u ON u.id = p.user_id WHERE p.pool_id = $1`, [poolId]
  );
  const agg: Record<number, { aligned: number; total: number }> = {};
  for (const pk of picks) {
    const a = (agg[pk.pid] ??= { aligned: 0, total: 0 });
    a.total++;
    if (modal[pk.mid] === pk.o) a.aligned++;
  }
  const aligned = entryRows
    .map((e: any) => {
      const a = agg[e.id] ?? { aligned: 0, total: 0 };
      return { name: e.display_name, label: e.label || null, total: a.total, pct: a.total > 0 ? a.aligned / a.total : 0 };
    })
    .filter((e) => e.total >= 10); // need a meaningful sample
  const mainstream = aligned.slice().sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 3);
  const contrarian = aligned.slice().sort((a, b) => a.pct - b.pct || b.total - a.total).slice(0, 3);

  return {
    pool: safePool, betsLocked: true, totalEntries, teams,
    champions, finalists, groupWinners, divisive, mainstream, contrarian, matchBreakdown,
  };
};
