import { getUserPools } from '$lib/server/queries.js';
import { db } from '$lib/server/db.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) return { pools: [], canCreate: false };
  const pools = getUserPools(locals.user.id);

  // Check if user can create pools
  let canCreate = false;
  if (locals.user) {
    const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'can_create_pools'").get() as any;
    const mode = setting?.value ?? 'admin';
    if (mode === 'anyone') {
      canCreate = true;
    } else {
      const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
      if (user?.is_admin) {
        canCreate = true;
      } else {
        const allowed = db.prepare('SELECT 1 FROM pool_creators WHERE user_id = ?').get(locals.user.id);
        canCreate = !!allowed;
      }
    }
  }

  return { pools, canCreate };
};
