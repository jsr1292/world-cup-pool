import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { calculateAllScores } from '$lib/server/scoring.js';
import { invalidateCachedPoolLeaderboard, invalidateCachedPoolResults, invalidateGlobalLeaderboard } from '$lib/server/cache.js';

// POST /api/admin/fifa-sync
// Triggers a manual FIFA API sync from the admin page
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Verify admin
  const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
  const user = userRows[0] ?? null;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  // TODO: When FIFA publishes 2026 WC API endpoints, activate this
  // For now, return a placeholder response
  try {
    // In production, this would call the FIFA sync script
    // const updated = await syncFromFifa();

    // Recalculate scores regardless (useful after manual edits)
    const { rows: pools } = await query('SELECT id FROM pools WHERE is_active = true');
    for (const p of pools) {
      await calculateAllScores(p.id);
      invalidateCachedPoolLeaderboard(p.id);
      invalidateCachedPoolResults(p.id);
    }
    invalidateGlobalLeaderboard();

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
