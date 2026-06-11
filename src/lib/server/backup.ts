/**
 * Backup — logical JSON dumps of every application table.
 *
 * "Crear backup" used to be a no-op stub that reported success while writing
 * nothing ("backups managed by Neon PITR"), and "Ver backups" truthfully
 * listed none — an admin pressing the button on deadline day believed they
 * had insurance they didn't have. It now writes a real dump.
 *
 * Where: BACKUP_DIR env var if set; otherwise /data/backups when /data exists
 * (the Home Assistant add-on's persistent volume, survives container
 * rebuilds); otherwise ./backups for local dev.
 *
 * What: every base table in the public schema EXCEPT volatile secret stores
 * (sessions, reset/verification tokens) — restoring without them just means
 * everyone logs in again. One JSON file per backup with a manifest header.
 *
 * Restore: intentionally manual. The dump is plain JSON; restoring mid-
 * tournament is a deliberate, careful operation — not a one-click button.
 * Neon PITR remains the primary disaster-recovery path.
 */
import { query } from './db.js';
import { mkdirSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXCLUDED_TABLES = new Set(['sessions', 'password_reset_tokens', 'email_verification_tokens']);

function backupDir(): string {
	const dir = process.env.BACKUP_DIR
		|| (existsSync('/data') ? '/data/backups' : 'backups');
	mkdirSync(dir, { recursive: true });
	return dir;
}

export async function createBackup(label = 'manual') {
	// Name must satisfy the endpoint's ^[A-Za-z0-9_-]+$ allowlist.
	const safeLabel = String(label).replace(/[^A-Za-z0-9]/g, '').slice(0, 20) || 'manual';
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const name = `backup-${safeLabel}-${stamp}`;

	const { rows: tableRows } = await query(
		`SELECT table_name FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
		 ORDER BY table_name`
	);
	const tables: Record<string, unknown[]> = {};
	const skipped: string[] = [];
	for (const { table_name } of tableRows as { table_name: string }[]) {
		if (EXCLUDED_TABLES.has(table_name)) { skipped.push(table_name); continue; }
		// table_name comes from information_schema, not user input — safe to
		// interpolate (identifiers cannot be bound as parameters anyway).
		const { rows } = await query(`SELECT * FROM "${table_name}"`);
		tables[table_name] = rows;
	}

	const payload = {
		manifest: {
			name,
			label: safeLabel,
			created_at: new Date().toISOString(),
			tables: Object.fromEntries(Object.entries(tables).map(([t, r]) => [t, r.length])),
			excluded: skipped,
			note: 'Logical JSON dump. Restore manually (or via Neon PITR for full disaster recovery).',
		},
		tables,
	};
	const dir = backupDir();
	const file = join(dir, `${name}.json`);
	writeFileSync(file, JSON.stringify(payload), 'utf8');
	const size = statSync(file).size;
	return { name, note: `Guardado en ${file}`, size };
}

export function listBackups() {
	const dir = backupDir();
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => {
			const st = statSync(join(dir, f));
			return { name: f.replace(/\.json$/, ''), size: st.size, created_at: st.mtime.toISOString() };
		})
		.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export function restoreBackup(_backupName: string) {
	throw new Error(
		'La restauración es manual: el backup es un JSON en el directorio de backups del servidor. Para recuperación completa usa Neon PITR.'
	);
}
