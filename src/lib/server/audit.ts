import { query } from './db.js';

// §4.8 — In-process counter of audit-log failures so ops can alert on it.
// Read via /api/health (out of scope to plumb here, but the counter is
// exported for any future endpoint that wants to surface it).
export const auditFailureCount = { value: 0 };

export async function logAudit(action: string, userId: number, entity: string, entityId: number | null, oldValue: any = null, newValue: any = null) {
  await query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, action, entity, entityId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(err => {
    auditFailureCount.value++;
    console.error('[audit] Failed to log:', err);
  });
}
