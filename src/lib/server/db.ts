import pg from 'pg';

let _pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
	if (!_pool) {
		const url = process.env.DATABASE_URL;
		if (!url) throw new Error('DATABASE_URL environment variable is required but not set');
		_pool = new pg.Pool({
			connectionString: url,
			max: 10,
			// H-05: Production-safe defaults for remote Postgres
			ssl: url.includes('localhost') || url.includes('127.0.0.1') ? false : { rejectUnauthorized: false },
			idleTimeoutMillis: 30_000,
			connectionTimeoutMillis: 10_000,
		});
		_pool.on('error', (err) => console.error('[db] Idle client error:', err.message));
	}
	return _pool;
}

export const query = (text: string, params?: unknown[]) => getPool().query(text, params);
export const getClient = () => getPool().connect();

// Graceful shutdown — close the pool when the server stops
async function shutdown() {
	if (_pool) {
		try {
			await _pool.end();
			console.log('[db] Pool closed gracefully');
		} catch (e) {
			console.error('[db] Error closing pool:', e);
		}
		_pool = null;
	}
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
// adapter-node emits this event before stopping
process.on('sveltekit:shutdown' as any, shutdown);
