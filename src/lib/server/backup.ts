import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../data/pool.db');
const BACKUP_DIR = join(__dirname, '../data/backups');
const MAX_BACKUPS = 30; // Keep last 30 backups (~1 month of daily)

function ensureBackupDir() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
}

function getTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export function createBackup(label = 'manual') {
  ensureBackupDir();

  // Checkpoint WAL first to ensure all data is in the main DB
  const db = new Database(DB_PATH);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  const backupName = `pool-${getTimestamp()}-${label}.db`;
  const backupPath = join(BACKUP_DIR, backupName);

  copyFileSync(DB_PATH, backupPath);

  // Clean old backups
  const backups = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('pool-') && f.endsWith('.db'))
    .map(f => ({ name: f, path: join(BACKUP_DIR, f), mtime: statSync(join(BACKUP_DIR, f)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);

  for (let i = MAX_BACKUPS; i < backups.length; i++) {
    unlinkSync(backups[i].path);
  }

  return { name: backupName, size: statSync(backupPath).size };
}

export function listBackups() {
  ensureBackupDir();
  return readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('pool-') && f.endsWith('.db'))
    .map(f => {
      const s = statSync(join(BACKUP_DIR, f));
      return { name: f, size: s.size, created: s.mtime.toISOString() };
    })
    .sort((a, b) => b.created.localeCompare(a.created));
}
