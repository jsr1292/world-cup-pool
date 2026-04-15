import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';

// POST /api/admin/results
// Body: { match_id, home_score, away_score }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { match_id, home_score, away_score } = await request.json() as {
    match_id: number; home_score: number; away_score: number;
  };

  if (match_id == null || home_score == null || away_score == null) {
    return json({ error: 'Missing fields' }, { status: 400 });
  }

  // Verify user is a pool creator (any pool)
  const ownedPool = db.prepare('SELECT id FROM pools WHERE created_by = ? LIMIT 1').get(locals.user.id) as any;
  if (!ownedPool) return json({ error: 'Forbidden' }, { status: 403 });

  // Get match
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(match_id) as any;
  if (!match) return json({ error: 'Match not found' }, { status: 404 });
  
  // Update match result
  db.prepare(
    "UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?"
  ).run(home_score, away_score, match_id);

  // Recalculate scores for all active pools
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
