import { query } from './db.js';

export async function logAudit(action: string, userId: number, entity: string, entityId: number | null, oldValue: any = null, newValue: any = null) {
  await query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)',
    [userId, action, entity, entityId, oldValue ? JSON.stringify(oldValue) : null, newValue ? JSON.stringify(newValue) : null]
  ).catch(err => console.error('[audit] Failed to log:', err));
}
