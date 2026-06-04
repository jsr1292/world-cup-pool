import { query } from './db.js';

// Lifetime cap on how many times a user may change their public @handle.
export const MAX_USERNAME_CHANGES = 3;

// 3–20 chars, lowercase letters / digits / underscore — same charset the
// registration handle-deriver produces, so changes stay consistent.
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase();
}

// How many username changes this user has already made — counted from the
// audit log (action='change_username'), so no schema change is needed.
export async function usernameChangesUsed(userId: number): Promise<number> {
  const { rows } = await query(
    "SELECT COUNT(*)::int AS c FROM audit_log WHERE user_id = $1 AND action = 'change_username'",
    [userId]
  );
  return Number(rows[0]?.c ?? 0);
}
