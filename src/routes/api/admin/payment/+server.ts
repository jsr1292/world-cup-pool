import { query, getClient } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';

// POST /api/admin/payment
// Body: { pool_id, user_id?, entry_id?, has_paid }
// If entry_id provided: toggle that entry only. Otherwise: toggle all entries for user.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const { pool_id, user_id, entry_id, has_paid } = await request.json() as {
    pool_id: number; user_id?: number; entry_id?: number; has_paid: boolean;
  };

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
  if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });

  const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] ?? null;
  if (!pool || pool.created_by !== locals.user.id) {
    return json({ error: 'Prohibido' }, { status: 403 });
  }

  const val = has_paid ? true : false;

  const client = await getClient();
  try {
    await client.query('BEGIN');

    if (entry_id) {
      // Single entry — also get user_id for pool_members update
      const { rows: entryRows } = await client.query('SELECT user_id FROM predictions WHERE id = $1 AND pool_id = $2', [entry_id, pool_id]);
      const entry = entryRows[0] ?? null;
      await client.query('UPDATE predictions SET has_paid = $1 WHERE id = $2 AND pool_id = $3', [val, entry_id, pool_id]);
      if (entry?.user_id) {
        await client.query('UPDATE pool_members SET has_paid = $1 WHERE pool_id = $2 AND user_id = $3', [val, pool_id, entry.user_id]);
      }
    } else if (user_id) {
      // All entries for this user in this pool
      await client.query('UPDATE predictions SET has_paid = $1 WHERE pool_id = $2 AND user_id = $3', [val, pool_id, user_id]);
      await client.query('UPDATE pool_members SET has_paid = $1 WHERE pool_id = $2 AND user_id = $3', [val, pool_id, user_id]);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return json({ ok: true });
};
