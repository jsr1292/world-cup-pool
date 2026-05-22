import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getScoringRules } from '$lib/server/scoring.js';

// GET /api/admin/scoring?pool_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const poolId = Number(url.searchParams.get('pool_id'));
  if (!poolId) return json({ error: 'Falta pool_id' }, { status: 400 });

  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [poolId]);
  const pool = poolRows[0] ?? null;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  return json(await getScoringRules(poolId));
};

// POST /api/admin/scoring
// Body: { pool_id, rules?: {...}, deadline_group?, deadline_knockout? }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json() as {
    pool_id: number;
    rules?: Record<string, number>;
    deadline_group?: string | null;
    deadline_knockout?: string | null;
  };
  const { pool_id, rules } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  // Update scoring rules if provided
  if (rules) {
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

  return json({ ok: true });
};
