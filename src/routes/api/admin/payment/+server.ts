import { query, getClient } from '$lib/server/db.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseJsonBody } from '$lib/server/json-body.js';
import { errCode } from '$lib/server/err-code.js';

// POST /api/admin/payment
// Body: { pool_id, user_id?, entry_id?, has_paid }
// If entry_id provided: toggle that entry only. Otherwise: toggle all entries for user.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  try {
    const parsed = await parseJsonBody(request);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body || typeof parsed.body !== 'object') {
      return json({ error: 'Cuerpo inválido' }, { status: 400 });
    }
    const { pool_id, user_id, entry_id, has_paid } = parsed.body as {
      pool_id?: number; user_id?: number; entry_id?: number; has_paid?: unknown;
    };

    if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });
    if (!user_id && !entry_id) return json({ error: 'Falta user_id o entry_id' }, { status: 400 });

    const { rows: poolRows } = await query('SELECT created_by FROM pools WHERE id = $1', [pool_id]);
    const pool = poolRows[0] ?? null;
    // B7-3: El creador de la quiniela O el admin del sitio pueden gestionar pagos
    if (!pool || (pool.created_by !== locals.user.id && !locals.user.is_admin)) {
      return json({ error: 'Prohibido' }, { status: 403 });
    }

    // §1.9 — Strict boolean coercion; "no"/"false"/0 must not become true.
    const val = has_paid === true;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      if (entry_id) {
        // Single entry — also get user_id for pool_members update
        const { rows: entryRows } = await client.query('SELECT user_id FROM predictions WHERE id = $1 AND pool_id = $2', [entry_id, pool_id]);
        const entry = entryRows[0] ?? null;
        // §3.2 — Surface a 404 when entry_id is cross-pool or missing so
        // automated probes are detectable and the client sees a real error.
        if (!entry) {
          await client.query('ROLLBACK');
          return json({ error: 'Entrada no encontrada' }, { status: 404 });
        }
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
  } catch (e) {
    const code = errCode();
    console.error(`[api/admin/payment] ${code}:`, e);
    return json({ error: 'Internal server error', code }, { status: 500 });
  }
};
