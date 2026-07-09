// src/services/endpointHealthService.ts
// Background poll of each enabled endpoint's container-sip-endpoint /api/status.
// Updates the current-value snapshot on intercom_endpoints and appends a
// time-series row to intercom_endpoint_health_log (pruned by retention).
// Direct adaptation of Walk the Nxt Floor's sipHealthService.
import { query } from '../db/pool';
import config from '../config';

interface Endpoint { id: string; name: string; rest_url: string | null; }

async function checkEndpoint(ep: Endpoint): Promise<void> {
  if (!ep.rest_url) return; // handsets without a REST API are skipped
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const start = Date.now();
    const resp = await fetch(`${ep.rest_url}/api/status`, { signal: controller.signal });
    const latencyMs = Date.now() - start;
    if (resp.ok) {
      await query(
        `UPDATE intercom_endpoints
         SET status='online', last_seen_at=now(), last_error=NULL, last_latency_ms=$2
         WHERE id=$1`, [ep.id, latencyMs]);
      await logHealth(ep.id, 'online', latencyMs, null);
    } else {
      const msg = `HTTP ${resp.status}`;
      await query(`UPDATE intercom_endpoints SET status='offline', last_error=$2 WHERE id=$1`, [ep.id, msg]);
      await logHealth(ep.id, 'offline', null, msg);
    }
  } catch (err) {
    const msg = (err as Error).message || 'Connection failed';
    await query(`UPDATE intercom_endpoints SET status='offline', last_error=$2 WHERE id=$1`, [ep.id, msg]);
    await logHealth(ep.id, 'offline', null, msg);
  } finally {
    clearTimeout(timeout);
  }
}

async function logHealth(endpointId: string, status: 'online' | 'offline', latencyMs: number | null, err: string | null): Promise<void> {
  try {
    await query(
      `INSERT INTO intercom_endpoint_health_log (endpoint_id, status, latency_ms, error_message)
       VALUES ($1, $2, $3, $4)`, [endpointId, status, latencyMs, err]);
  } catch (e) {
    console.error('[health] Failed to write health log:', (e as Error).message);
  }
}

export async function runHealthChecks(): Promise<void> {
  try {
    const { rows } = await query<Endpoint>(
      `SELECT id, name, rest_url FROM intercom_endpoints WHERE enabled = TRUE`);
    await Promise.allSettled(rows.map(checkEndpoint));
  } catch (err) {
    console.error('[health] Check failed:', (err as Error).message);
  }
}

async function pruneHealthLog(): Promise<void> {
  try {
    const result = await query(
      `DELETE FROM intercom_endpoint_health_log WHERE checked_at < now() - ($1 || ' days')::interval`,
      [config.healthLogRetentionDays]);
    if (result.rowCount) console.log(`[health] Pruned ${result.rowCount} log row(s) > ${config.healthLogRetentionDays}d`);
  } catch (err) {
    console.error('[health] Failed to prune health log:', (err as Error).message);
  }
}

export function startHealthScheduler(): void {
  console.log(`[health] Polling endpoints every ${config.healthInterval / 1000}s`);
  void runHealthChecks();
  setInterval(() => void runHealthChecks(), config.healthInterval);
  setInterval(() => void pruneHealthLog(), 60 * 60 * 1000);
}
