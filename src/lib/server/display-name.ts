import { query } from './db.js';

// Lifetime cap on how many times a user may change their display name (the
// prominent name shown in each pool's Clasificación).
export const MAX_DISPLAY_NAME_CHANGES = 3;

// Collapse internal whitespace and trim. Display names are free-form (not unique,
// not an identity key) — 1–50 chars, matching registration.
export function normalizeDisplayName(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

// How many display-name changes this user has made — counted from the audit log
// (action='change_display_name'), so no schema change is needed.
export async function displayNameChangesUsed(userId: number): Promise<number> {
  const { rows } = await query(
    "SELECT COUNT(*)::int AS c FROM audit_log WHERE user_id = $1 AND action = 'change_display_name'",
    [userId]
  );
  return Number(rows[0]?.c ?? 0);
}
