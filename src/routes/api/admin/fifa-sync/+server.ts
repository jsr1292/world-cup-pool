import { query } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { syncAndRescore } from '$lib/server/sync-runner.js';
import { errCode } from '$lib/server/err-code.js';

// POST /api/admin/fifa-sync
// Manually trigger a live-score sync + full rescore from the admin page.
// If no provider (API_FOOTBALL_KEY / FIFA fallback) is configured, syncScores
// returns 0 matches and this is effectively just a rescore.
export const POST: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  // Verify admin
  const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
  const user = userRows[0] ?? null;
  if (!user?.is_admin) return json({ error: 'Prohibido' }, { status: 403 });

  try {
    const r = await syncAndRescore();
    return json({
      ok: true,
      updated: r.updated,
      skipped: r.skipped,
      errors: r.errors,
      unmatched: r.unmatched,
      pools: r.pools,
    });
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/fifa-sync] ${code}:`, e);
    return json({ error: 'Error en sincronización', code }, { status: 500 });
  }
};
