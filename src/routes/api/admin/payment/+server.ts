import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// POST /api/admin/payment
// Body: { pool_id, user_id, has_paid }
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { pool_id, user_id, has_paid } = await request.json() as {
    pool_id: number; user_id: number; has_paid: boolean;
  };

  if (!pool_id || !user_id) return json({ error: 'Missing fields' }, { status: 400 });

  const pool = db.prepare('SELECT created_by FROM pools WHERE id = ?').get(pool_id) as any;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  db.prepare('UPDATE pool_members SET has_paid = ? WHERE pool_id = ? AND user_id = ?')
    .run(has_paid ? 1 : 0, pool_id, user_id);

  return json({ ok: true });
};
