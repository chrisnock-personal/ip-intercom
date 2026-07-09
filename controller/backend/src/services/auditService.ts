// src/services/auditService.ts — non-blocking append to audit_log.
import { query } from '../db/pool';

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'login' | 'logout'
  | 'call_start' | 'call_end' | 'page' | 'ptt_grant' | 'ptt_release'
  | 'group_join' | 'group_leave';

export async function audit(
  actor: string, entity_type: string, entity_id: string,
  action: AuditAction, metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (actor, entity_type, entity_id, action, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [actor, entity_type, entity_id, action, metadata ? JSON.stringify(metadata) : null]);
  } catch (err) {
    console.error('[audit] Failed to write audit record:', (err as Error).message);
  }
}
