import { syncScores } from '$lib/server/live-scores.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// POST /api/admin/sync-scores
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Only global admins can sync live scores
  if (!locals.user.is_admin) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  const result = await syncScores();

  // If any matches were updated, recalculate scores for all active pools
  if (result.updated > 0) {
    const pools = db.prepare('SELECT id FROM pools WHERE is_active = 1').all() as any[];
    for (const pool of pools) {
      try {
        calculateAllScores(pool.id);
      } catch (e) {
        console.error(`Error calculating scores for pool ${pool.id}:`, e);
      }
    }
  }

  return json({ ok: true, ...result });
};
