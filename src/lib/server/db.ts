import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required but not set');
}

export const pool = new pg.Pool({
	connectionString: DATABASE_URL,
	max: 10
});

pool.on('error', (err, _client) => {
	console.error('[db] Unexpected idle client error:', err.message);
});

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
export const getClient = () => pool.connect();
export const getClient = () => pool.connect();
