import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getScoringRules } from '$lib/server/scoring.js';
import { logAudit } from '$lib/server/audit.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';

const VALID_RULES = new Set([
  // match_outcome = points per correct 1/X/2 group result; group_position = bonus
  // per correct derived standing (off by default). goal_difference/exact_score were
  // dropped with the W/D/L model and are no longer accepted.
  'match_outcome', 'group_position',
  'knockout_r32', 'knockout_r16', 'knockout_qf', 'knockout_sf',
  'knockout_final', 'knockout_winner', 'third_place',
]);

// GET /api/admin/scoring?pool_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const poolId = Number(url.searchParams.get('pool_id'));
  if (!poolId) return json({ error: 'Falta pool_id' }, { status: 400 });

  try {
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [poolId]);
    const pool = poolRows[0] ?? null;
    // §1.7 — Pool creator OR site admin can manage scoring rules.
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    return json(await getScoringRules(poolId));
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/scoring] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};

// POST /api/admin/scoring
// Body: { pool_id, rules?: {...}, deadline_group?, deadline_knockout? }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as {
    pool_id: number;
    rules?: Record<string, number>;
    deadline_group?: string | null;
    deadline_knockout?: string | null;
  };
  if (!body) return json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  const { pool_id, rules } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  try {
    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    if (!pool || pool.created_by !== locals.user.id) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    // Update scoring rules if provided
    if (rules) {
      for (const rule of Object.keys(rules)) {
        if (!VALID_RULES.has(rule)) {
          return json({ error: `Regla inválida: ${rule}` }, { status: 400 });
        }
      }
      for (const [rule, points] of Object.entries(rules)) {
        if (typeof points === 'number' && points >= 0) {
          await query(`
            INSERT INTO scoring_config (pool_id, rule, points) VALUES ($1, $2, $3)
            ON CONFLICT(pool_id, rule) DO UPDATE SET points = $3
          `, [pool_id, rule, points]);
        }
      }
    }

    // Update deadlines if provided
    if (body.deadline_group !== undefined || body.deadline_knockout !== undefined) {
      const updates: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;
      if (body.deadline_group !== undefined) {
        updates.push(`deadline_group = $${paramIdx++}`);
        values.push(body.deadline_group || null);
      }
      if (body.deadline_knockout !== undefined) {
        updates.push(`deadline_knockout = $${paramIdx++}`);
        values.push(body.deadline_knockout || null);
      }
      if (updates.length > 0) {
        values.push(pool_id);
        await query(`UPDATE pools SET ${updates.join(', ')} WHERE id = $${paramIdx}`, values);
      }
    }

    await logAudit('update_scoring', locals.user.id, 'pool', pool_id, null, { rules, deadline_group: body.deadline_group, deadline_knockout: body.deadline_knockout });

    return json({ ok: true });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/scoring] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
