import { query } from '$lib/server/db.js';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(302, '/login');
  }

  const { rows: userRows } = await query('SELECT is_admin FROM users WHERE id = $1', [locals.user.id]);
  const user = userRows[0] ?? null;
  if (!user?.is_admin) {
    throw redirect(302, '/pools');
  }

  const { rows: settingRows } = await query("SELECT value FROM site_settings WHERE key = 'can_create_pools'");
  const setting = settingRows[0] ?? null;
  const { rows: creators } = await query(`
    SELECT u.id, u.display_name, u.username
    FROM pool_creators pc
    JOIN users u ON u.id = pc.user_id
    ORDER BY u.display_name
  `);

  const { rows: allUsers } = await query(`
    SELECT id, display_name, username
    FROM users
    WHERE is_admin = false
    ORDER BY display_name
  `);

  return {
    mode: setting?.value ?? 'admin',
    creators,
    allUsers,
  };
};
