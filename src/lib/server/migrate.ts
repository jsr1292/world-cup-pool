/**
 * Migration runner — applies pending SQL migrations in order.
 *
 * Reads SQL files from:
 *   - drizzle/migrations/*.sql
 *   - src/lib/server/migrations/*.sql
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

		// Collect SQL files from both directories
		const dirs = [
			join(projectRoot, 'drizzle/migrations'),
			join(__dirname, 'migrations'),
		];

		const files: { filename: string; fullPath: string }[] = [];

		for (const dir of dirs) {
			try {
				const entries = readdirSync(dir)
					.filter(f => f.endsWith('.sql'))
					.sort();
				for (const f of entries) {
					files.push({ filename: f, fullPath: join(dir, f) });
				}
			} catch (e: any) {
				if (e.code !== 'ENOENT') throw e;
				// Directory doesn't exist — skip silently
			}
		}

		// Deduplicate by filename in case of overlap; first occurrence wins
		const seen = new Set<string>();
		const uniqueFiles = files.filter(({ filename }) => {
			if (seen.has(filename)) return false;
			seen.add(filename);
			return true;
		});

		// Sort all collected files by filename so order is deterministic
		uniqueFiles.sort((a, b) => a.filename.localeCompare(b.filename));

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
			const sql = readFileSync(fullPath, 'utf-8');

			await pool.query('BEGIN');
			try {
				await pool.query(sql);
				await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
				await pool.query('COMMIT');
				console.log(`[migrate] ✓     ${filename}`);
				applied++;
			} catch (e) {
				await pool.query('ROLLBACK');
				throw e;
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
