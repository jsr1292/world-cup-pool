import { json } from '@sveltejs/kit';
import { getPool } from '$lib/server/db.js';
import type { RequestHandler } from './$types.js';
import { auditFailureCount } from '$lib/server/audit.js';
import { getCacheStats } from '$lib/server/cache.js';

export const GET: RequestHandler = async () => {
	try {
		const pgPool = getPool();
		await pgPool.query('SELECT 1');
		// §6.4 + §6.5 — Expose pool / cache / audit metrics so ops can alert
		// without scraping logs.
		return json({
			status: 'ok',
			db: true,
			pool: {
				total: pgPool.totalCount,
				idle: pgPool.idleCount,
				waiting: pgPool.waitingCount,
			},
			cache: getCacheStats(),
			audit: { failureCount: auditFailureCount.value },
		});
	} catch (e) {
		console.error('[health] DB check failed:', e);
		return json({ status: 'error', db: false }, { status: 503 });
	}
};
