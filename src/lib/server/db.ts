import pg from 'pg';

export const pool = new pg.Pool({
	connectionString: process.env.DATABASE_URL,
	max: 10
});

export const query = (text: string, params?: unknown[]) => pool.query(text, params);

export const getClient = () => pool.connect();
