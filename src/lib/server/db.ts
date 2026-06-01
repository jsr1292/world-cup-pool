import pg from 'pg';

let _pool: pg.Pool | null = null;
let _shuttingDown = false;

export function getPool(): pg.Pool {
	if (_shuttingDown) throw new Error('[db] Server is shutting down');
	if (!_pool) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL environment variable is required but not set');
		_pool = new pg.Pool({
			connectionString: url,
			max: 10,
			ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
			// §4.9 — Set application_name so DBA dashboards (pg_stat_activity)
			// can identify this app's connections.
			application_name: process.env.PG_APPLICATION_NAME || 'mundial2026',
		});
		_pool.on('error', (err) => console.error('[db] Idle client error:', err.message));
	}
	return _pool;
}

export const query = (text: string, params?: unknown[]) => getPool().query(text, params);
export const getClient = () => getPool().connect();

// Graceful shutdown — close the pool when the server stops. adapter-node fires
// BOTH 'sveltekit:shutdown' and a signal, so guard against running twice (which
// otherwise logs a noisy "Called end on pool more than once" error).
async function shutdown() {
	if (_shuttingDown) return;
	_shuttingDown = true;
	const pool = _pool;
	_pool = null;
	if (pool) {
		try {
			await pool.end();
			console.log('[db] Pool closed gracefully');
		} catch (e) {
			console.error('[db] Error closing pool:', e);
		}
	}
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// adapter-node emits this event before stopping
process.on('sveltekit:shutdown' as any, shutdown);
