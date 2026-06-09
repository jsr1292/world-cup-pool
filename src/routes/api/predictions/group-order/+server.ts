import { errCode } from '$lib/server/err-code.js';
import { asId } from '$lib/server/json-body.js';
import { query } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';
import { checkPredictionRate } from '$lib/server/rate-limit.js';

// POST /api/predictions/group-order
// Body: { prediction_id, group_name, order: number[] }  (team ids, 1st → last)
// Sets the player's MANUAL group-table order (their tiebreak among teams level on
// points). `order` must be a permutation of the group's teams and must respect
// points — you can't place a team above one with more points. Persisted to
// group_predictions.position_1..4, which the knockout bracket seeds from.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });
  if (!checkPredictionRate(locals.user.id)) {
    return json({ error: 'Demasiadas peticiones. Espera un momento.' }, { status: 429 });
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
  const prediction_id = asId(body?.prediction_id) ?? 0;
  const group_name = String(body?.group_name ?? '');
  const order: number[] | null = Array.isArray(body?.order) ? body.order.map(Number) : null;
  if (!prediction_id || !group_name || !order || order.length === 0) {
    return json({ error: 'Datos incompletos' }, { status: 400 });
  }
  if (order.some((n) => !Number.isInteger(n))) return json({ error: 'Orden inválido' }, { status: 400 });

  try {
    const { rows: predRows } = await query('SELECT user_id, pool_id FROM predictions WHERE id = $1', [prediction_id]);
    const pred = predRows[0] ?? null;
    if (!pred || pred.user_id !== locals.user.id) return json({ error: 'No es tu predicción' }, { status: 403 });

    const { rows: membership } = await query('SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2', [pred.pool_id, locals.user.id]);
    if (membership.length === 0) return json({ error: 'No eres miembro de este pool' }, { status: 403 });

    const { rows: poolRows } = await query('SELECT deadline_group FROM pools WHERE id = $1', [pred.pool_id]);
    const pool = poolRows[0] ?? null;
    if (pool?.deadline_group && new Date(pool.deadline_group) <= new Date()) {
      return json({ error: 'La fecha límite ha pasado' }, { status: 403 });
    }

    // The group's real teams.
    const { rows: teamRows } = await query(
      `SELECT DISTINCT tid FROM (
         SELECT home_team_id AS tid FROM matches WHERE phase = 'group' AND group_name = $1
         UNION SELECT away_team_id AS tid FROM matches WHERE phase = 'group' AND group_name = $1
       ) s WHERE tid IS NOT NULL`,
      [group_name]
    );
    const groupTeamIds = new Set(teamRows.map((r: any) => Number(r.tid)));
    if (groupTeamIds.size === 0) return json({ error: 'Grupo desconocido' }, { status: 400 });
    if (order.length !== groupTeamIds.size || new Set(order).size !== order.length || !order.every((id) => groupTeamIds.has(id))) {
      return json({ error: 'El orden debe incluir a todos los equipos del grupo una vez' }, { status: 400 });
    }

    // Points per team from this entry's saved group scorelines.
    const { rows: gms } = await query(
      `SELECT m.home_team_id, m.away_team_id, mp.home_score, mp.away_score
         FROM match_predictions mp JOIN matches m ON m.id = mp.match_id
        WHERE mp.prediction_id = $1 AND m.phase = 'group' AND m.group_name = $2`,
      [prediction_id, group_name]
    );
    const pts: Record<number, number> = {};
    for (const id of groupTeamIds) pts[id] = 0;
    for (const m of gms) {
      if (m.home_score == null || m.away_score == null) continue;
      if (m.home_score > m.away_score) pts[m.home_team_id] += 3;
      else if (m.home_score < m.away_score) pts[m.away_team_id] += 3;
      else { pts[m.home_team_id] += 1; pts[m.away_team_id] += 1; }
    }
    for (let i = 1; i < order.length; i++) {
      if ((pts[order[i - 1]] ?? 0) < (pts[order[i]] ?? 0)) {
        return json({ error: 'No puedes colocar un equipo por encima de otro con más puntos' }, { status: 400 });
      }
    }

    await query(
      `INSERT INTO group_predictions (prediction_id, group_name, position_1, position_2, position_3, position_4)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT(prediction_id, group_name) DO UPDATE SET
         position_1 = $3, position_2 = $4, position_3 = $5, position_4 = $6`,
      [prediction_id, group_name, order[0] ?? null, order[1] ?? null, order[2] ?? null, order[3] ?? null]
    );

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/predictions/group-order] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
