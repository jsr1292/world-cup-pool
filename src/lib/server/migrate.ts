/**
 * Migration runner — applies pending SQL migrations in order.
 *
 * Reads SQL files from:
 *   - drizzle/migrations/*.sql
 *
 * Tracks applied migrations in the _migrations table so each file
 * runs exactly once. Combined with idempotent SQL (IF NOT EXISTS,
 * DO $$ EXCEPTION blocks), re-running is always safe.
 *
 * Usage:
 *   npm run migrate
 *   (or: tsx src/lib/server/migrate.ts)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Project root is 3 levels up from src/lib/server/
const projectRoot = resolve(__dirname, '../../../');

async function runMigrations(): Promise<void> {
	const url = process.env.DATABASE_URL;
	if (!url) {
		console.error('[migrate] DATABASE_URL environment variable is required');
		process.exit(1);
	}

	const pool = new pg.Pool({ connectionString: url });

	try {
		// Create migration tracking table
		await pool.query(`
			CREATE TABLE IF NOT EXISTS _migrations (
				id SERIAL PRIMARY KEY,
				filename TEXT NOT NULL UNIQUE,
				applied_at TIMESTAMPTZ DEFAULT NOW()
			)
		`);

		// Collect SQL files from drizzle/migrations
		const migrationDir = join(projectRoot, 'drizzle/migrations');
		const entries = readdirSync(migrationDir)
			.filter(f => f.endsWith('.sql'))
			.sort();
		const uniqueFiles = entries.map(f => ({ filename: f, fullPath: join(migrationDir, f) }));

		let applied = 0;
		let skipped = 0;

		for (const { filename, fullPath } of uniqueFiles) {
			const { rows } = await pool.query(
				'SELECT 1 FROM _migrations WHERE filename = $1',
				[filename]
			);

			if (rows.length > 0) {
				console.log(`[migrate] skip  ${filename} (already applied)`);
				skipped++;
				continue;
			}

			console.log(`[migrate] apply ${filename} …`);
			// §7.6 — Synchronous read intentional: migrate is a one-shot startup
			// script, so blocking the event loop here is fine.
			const sql = readFileSync(fullPath, 'utf-8');

			const client = await pool.connect();
			try {
				await client.query('BEGIN');
				await client.query(sql);
				await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
				await client.query('COMMIT');
				console.log(`[migrate] ✓     ${filename}`);
				applied++;
			} catch (e) {
				await client.query('ROLLBACK');
				throw e;
			} finally {
				client.release();
			}
		}

		console.log(`[migrate] Done. ${applied} applied, ${skipped} skipped.`);
	} finally {
		await pool.end();
	}
}

runMigrations().catch(e => {
	console.error('[migrate] Fatal error:', e);
	process.exit(1);
});
