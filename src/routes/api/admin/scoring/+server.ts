import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getScoringRules } from '$lib/server/scoring.js';

// GET /api/admin/scoring?pool_id=X
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const poolId = Number(url.searchParams.get('pool_id'));
  if (!poolId) return json({ error: 'Missing pool_id' }, { status: 400 });

  // Verify admin
  const pool = db.prepare('SELECT created_by FROM pools WHERE id = ?').get(poolId) as any;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  return json(getScoringRules(poolId));
};

// POST /api/admin/scoring
// Body: { pool_id, rules: { group_position: 3, r32_winner: 5, ... } }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { pool_id, rules } = await request.json() as { pool_id: number; rules: Record<string, number> };
  if (!pool_id || !rules) return json({ error: 'Missing pool_id or rules' }, { status: 400 });

  const pool = db.prepare('SELECT created_by FROM pools WHERE id = ?').get(pool_id) as any;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const upsert = db.prepare(`
    INSERT INTO scoring_config (pool_id, rule, points) VALUES (?, ?, ?)
    ON CONFLICT(pool_id, rule) DO UPDATE SET points = ?
  `);

  const saveAll = db.transaction(() => {
    for (const [rule, points] of Object.entries(rules)) {
      if (typeof points === 'number' && points >= 0) {
        upsert.run(pool_id, rule, points, points);
      }
    }
  });

  saveAll();
  return json({ ok: true });
};
