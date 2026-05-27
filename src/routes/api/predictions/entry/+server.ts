import { query, getClient } from '$lib/server/db.js';
import { json, type RequestHandler } from '@sveltejs/kit';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'No autorizado' }, { status: 401 });

  const body = await request.json();
  const { pool_id, label = '' } = body;

  if (!pool_id) return json({ error: 'Falta pool_id' }, { status: 400 });

  // Check allow_multiple
  const { rows: poolRows } = await query('SELECT * FROM pools WHERE id = $1', [pool_id]);
  const pool = poolRows[0] as any;
  if (!pool) return json({ error: 'Quiniela no encontrada' }, { status: 404 });

  const { rows: memberRows } = await query(
    'SELECT 1 FROM pool_members WHERE pool_id = $1 AND user_id = $2',
    [pool_id, locals.user.id]
  );
  if (memberRows.length === 0) return json({ error: 'No eres miembro de esta quiniela' }, { status: 403 });

	// Use a transaction with FOR UPDATE to eliminate the TOCTOU race between
	// the "no existing prediction" check and the INSERT.
	const client = await getClient();
	try {
		await client.query('BEGIN');

		// Lock existing predictions for this user+pool — prevents concurrent duplicate inserts
		const { rows: existing } = await client.query(
			'SELECT id, label FROM predictions WHERE pool_id = $1 AND user_id = $2 FOR UPDATE',
			[pool_id, locals.user.id]
		);

		// Enforce allow_multiple_predictions under the lock
		if (!pool.allow_multiple_predictions && existing.length > 0) {
			await client.query('ROLLBACK');
			return json({ error: 'Ya tienes una predicción en esta quiniela' }, { status: 403 });
		}

		// Check label uniqueness under the lock
		if (existing.some((r: any) => r.label === label)) {
			await client.query('ROLLBACK');
			return json({ error: 'Ya existe una entrada con ese nombre' }, { status: 409 });
		}

		// Inherit has_paid from pool_members
		const { rows: memberRows } = await client.query(
			'SELECT has_paid FROM pool_members WHERE pool_id = $1 AND user_id = $2',
			[pool_id, locals.user.id]
		);
		const hasPaid = memberRows[0]?.has_paid ?? false;

		const { rows } = await client.query(
			`INSERT INTO predictions (user_id, pool_id, label, total_score, has_paid)
			 VALUES ($1, $2, $3, 0, $4)
			 RETURNING id`,
			[locals.user.id, pool_id, label, hasPaid]
		);

		await client.query('COMMIT');
		return json({ id: Number(rows[0].id), label });
	} catch (e) {
		await client.query('ROLLBACK');
		throw e;
	} finally {
		client.release();
	}
};
