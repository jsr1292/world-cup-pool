import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';

// POST /api/admin/results
// Body: { match_id, home_score, away_score }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const { pool_id, match_id, home_score, away_score } = await request.json() as {
    pool_id: number; match_id: number; home_score: number; away_score: number;
  };

  if (match_id == null || home_score == null || away_score == null) {
    return json({ error: 'Faltan campos' }, { status: 400 });
  }

  // Verify user owns THIS pool
  const pool = db.prepare('SELECT created_by FROM pools WHERE id = ?').get(pool_id) as any;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  // Get match
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id) as any;
  if (!match) return json({ error: 'Partido no encontrado' }, { status: 404 });
  
  // Update match result
  db.prepare(
    "UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?"
  ).run(home_score, away_score, match_id);

  // Recalculate scores for all active pools (match results are shared across pools)
  const pools = db.prepare('SELECT id FROM pools WHERE is_active = 1').all() as any[];
  for (const p of pools) {
    try {
      calculateAllScores(p.id);
    } catch (e) {
      console.error(`Score calc error for pool ${p.id}:`, e);
    }
  }

  return json({ ok: true });
};
