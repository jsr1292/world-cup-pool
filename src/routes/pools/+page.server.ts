import { getUserPools } from '$lib/server/queries.js';
import { query } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) return { pools: [], canCreate: false };
  const pools = await getUserPools(locals.user.id);

  // Check if user can create pools
  let canCreate = false;
  if (locals.user) {
    const { rows: settingRows } = await query("SELECT value FROM site_settings WHERE key = 'can_create_pools'");
    const setting = settingRows[0] as any;
    const mode = setting?.value ?? 'admin';
    if (mode === 'anyone') {
      canCreate = true;
    } else {
      const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
      const user = userRows[0] as any;
      if (user?.is_admin) {
        canCreate = true;
      } else {
        const { rows: allowedRows } = await query('SELECT 1 FROM pool_creators WHERE user_id = $1', [locals.user.id]);
        canCreate = allowedRows.length > 0;
      }
    }
  }

  return { pools, canCreate };
};
