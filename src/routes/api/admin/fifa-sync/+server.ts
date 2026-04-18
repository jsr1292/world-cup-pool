import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';

// POST /api/admin/fifa-sync
// Triggers a manual FIFA API sync from the admin page
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Verify admin
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  // TODO: When FIFA publishes 2026 WC API endpoints, activate this
  // For now, return a placeholder response
  try {
    // In production, this would call the FIFA sync script
    // const updated = await syncFromFifa();

    // Recalculate scores regardless (useful after manual edits)
    const pools = db.prepare('SELECT id FROM pools WHERE is_active = 1').all() as any[];
    for (const p of pools) {
      calculateAllScores(p.id);
    }

    return json({
      ok: true,
      updated: 0,
      message: 'FIFA sync will be active closer to the tournament. Scores recalculated.',
      pools: pools.length,
    });
  } catch (e) {
    console.error('FIFA sync error:', e);
    return json({ error: 'Error en sincronización' }, { status: 500 });
  }
};
