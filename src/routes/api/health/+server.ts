import { json } from '@sveltejs/kit';
import { getPool } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async () => {
	try {
		await getPool().query('SELECT 1');
		return json({ status: 'ok', db: true });
	} catch (e) {
		console.error('[health] DB check failed:', e);
		return json({ status: 'error', db: false }, { status: 503 });
	}
};
