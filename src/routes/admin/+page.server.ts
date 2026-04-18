import { db } from '$lib/server/db.js';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) {
    throw redirect(302, '/login');
  }

  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(locals.user.id) as any;
  if (!user?.is_admin) {
    throw redirect(302, '/pools');
  }

  const setting = db.prepare("SELECT value FROM site_settings WHERE key = 'can_create_pools'").get() as any;
  const creators = db.prepare(`
    SELECT u.id, u.display_name, u.username
    FROM pool_creators pc
    JOIN users u ON u.id = pc.user_id
    ORDER BY u.display_name
  `).all();

  const allUsers = db.prepare(`
    SELECT id, display_name, username
    FROM users
    WHERE is_admin = 0
    ORDER BY display_name
  `).all();

  return {
    mode: setting?.value ?? 'admin',
    creators,
    allUsers,
  };
};
