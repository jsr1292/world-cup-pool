/**
 * Backup — PostgreSQL / Neon
 *
 * Neon handles backups via built-in PITR (Point-in-Time Recovery).
 * No local file-based backups needed.
 */

export function createBackup(label = 'manual') {
	return {
		name: `neon-pitr-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`,
		note: 'Backups managed by Neon PITR. Use Neon console for restore.',
		size: 0
	};
}

export function listBackups() {
	return [];
}

export function restoreBackup(_backupName: string) {
	throw new Error('Use Neon console to restore from PITR backup');
}
