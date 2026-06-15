import { query } from '$lib/server/db.js';
import { getPoolById } from '$lib/server/queries.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';

// GET /api/pools/[id]/match-bets?match=<matchId>
// Every entry's 1/X/2 pick for a GROUP match, once the pool is fully locked
// (same privacy rule as viewing bets / stats). Members only.
export const GET: RequestHandler = async ({ params, url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const poolId = Number(params.id);
  if (!Number.isInteger(poolId) || poolId < 1 || poolId > 2147483647) return json({ error: 'Quiniela no encontrada' }, { status: 404 });
  const matchId = Number(url.searchParams.get('match'));
  if (!Number.isInteger(matchId) || matchId < 1) return json({ error: 'match inválido' }, { status: 400 });

  const pool = await getPoolById(poolId) as any;
  if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });

  const { rows: gate } = await query('SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [poolId, locals.user.id]);
  if (gate.length === 0 && pool.created_by !== locals.user.id) return json({ error: 'No eres miembro' }, { status: 403 });

  const dg = pool.deadline_group ? new Date(pool.deadline_group) : null;
  const dk = pool.deadline_knockout ? new Date(pool.deadline_knockout) : null;
  const now = new Date();
  const betsLocked = !!dg && dg <= now && !!dk && dk <= now;
  if (!betsLocked) return json({ error: 'Las apuestas aún no están bloqueadas', locked: false }, { status: 403 });

  // The match must be a GROUP fixture (knockout has no per-match 1/X/2 bet).
  const { rows: mrows } = await query(
    `SELECT m.id, m.group_name, m.status, m.home_score, m.away_score,
            t1.name AS home_name, t1.flag_code AS home_flag,
            t2.name AS away_name, t2.flag_code AS away_flag
     FROM matches m
     LEFT JOIN teams t1 ON t1.id = m.home_team_id
     LEFT JOIN teams t2 ON t2.id = m.away_team_id
     WHERE m.id = $1 AND m.phase = 'group'`, [matchId]);
  if (mrows.length === 0) return json({ error: 'Partido no válido' }, { status: 404 });
  const m = mrows[0];
  const finished = m.status === 'finished' && m.home_score != null && m.away_score != null;
  const actual = finished ? (m.home_score > m.away_score ? '1' : m.home_score < m.away_score ? '2' : 'X') : null;

  const { rows } = await query(
    `SELECT u.display_name, p.label, mp.home_score AS ph, mp.away_score AS pa
     FROM match_predictions mp
     JOIN predictions p ON p.id = mp.prediction_id
     JOIN users u ON u.id = p.user_id
     WHERE p.pool_id = $1 AND mp.match_id = $2
       AND mp.home_score IS NOT NULL AND mp.away_score IS NOT NULL
     ORDER BY u.display_name, p.id`, [poolId, matchId]);

  const tally: Record<string, number> = { '1': 0, X: 0, '2': 0 };
  const bets = rows.map((r: any) => {
    const pick = r.ph > r.pa ? '1' : r.ph < r.pa ? '2' : 'X';
    tally[pick]++;
    return { name: r.display_name, label: r.label || null, pick, correct: actual ? pick === actual : null };
  });

  return json({
    match: {
      id: m.id, group_name: m.group_name, finished,
      home_name: m.home_name, home_flag: m.home_flag,
      away_name: m.away_name, away_flag: m.away_flag,
      home_score: m.home_score, away_score: m.away_score, actual,
    },
    tally, bets,
  });
};
