import { db } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// POST /api/admin/payment
// Body: { pool_id, user_id?, entry_id?, has_paid }
// If entry_id provided: toggle that entry only. Otherwise: toggle all entries for user.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

  const { pool_id, user_id, entry_id, has_paid } = await request.json() as {
    pool_id: number; user_id?: number; entry_id?: number; has_paid: boolean;
  };

  if (!pool_id) return json({ error: 'Missing pool_id' }, { status: 400 });

  const pool = db.prepare('SELECT created_by FROM pools WHERE id = ?').get(pool_id) as any;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const val = has_paid ? 1 : 0;

  if (entry_id) {
    // Single entry
    db.prepare('UPDATE predictions SET has_paid = ? WHERE id = ? AND pool_id = ?')
      .run(val, entry_id, pool_id);
  } else if (user_id) {
    // All entries for this user in this pool
    db.prepare('UPDATE predictions SET has_paid = ? WHERE pool_id = ? AND user_id = ?')
      .run(val, pool_id, user_id);
    // Also update legacy pool_members
    db.prepare('UPDATE pool_members SET has_paid = ? WHERE pool_id = ? AND user_id = ?')
      .run(val, pool_id, user_id);
  } else {
    return json({ error: 'Must provide user_id or entry_id' }, { status: 400 });
  }

  return json({ ok: true });
};
