// src/routes/system.ts
// System Health + Audit log, admin-only. Ported from Walk the Nxt Floor's
// backend/src/routes/system.ts — same shape for the parts that are 100%
// generic Linux/Postgres (host CPU/mem/disk, db stats, audit search), but
// adapted where WTNF assumed a single container: no supervisor log files
// here, so the log viewer talks to the podman API socket instead of tailing
// local files, and there's a genuine pbx-core reachability check WTNF has
// no equivalent of.
import { Router, Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { requireAuth, requireRole } from '../middleware/session';
import { query, queryOne } from '../db/pool';
import config from '../config';

const router = Router();
const adminOnly = requireRole('admin');
router.use(requireAuth, adminOnly);

// ── Host resource helpers (generic Linux — same as WTNF's) ──────────────────
function getMemoryInfo(): { total_mb: number; free_mb: number; used_mb: number; used_pct: number } {
  try {
    const raw = fs.readFileSync('/proc/meminfo', 'utf8');
    const getKb = (key: string) => {
      const match = raw.split('\n').find(l => l.startsWith(key));
      return match ? parseInt(match.split(/\s+/)[1]) : 0;
    };
    const total     = getKb('MemTotal:')     * 1024;
    const available = getKb('MemAvailable:') * 1024;
    const used      = total - available;
    return {
      total_mb: Math.round(total     / 1024 / 1024),
      free_mb:  Math.round(available / 1024 / 1024),
      used_mb:  Math.round(used      / 1024 / 1024),
      used_pct: total > 0 ? Math.round((used / total) * 100) : 0,
    };
  } catch {
    const total = os.totalmem();
    const free  = os.freemem();
    return {
      total_mb: Math.round(total          / 1024 / 1024),
      free_mb:  Math.round(free           / 1024 / 1024),
      used_mb:  Math.round((total - free) / 1024 / 1024),
      used_pct: Math.round(((total - free) / total) * 100),
    };
  }
}

function getDiskInfo(): { used_mb: number; total_mb: number; free_mb: number; used_pct: number } {
  try {
    const output = execSync('df -k /', { encoding: 'utf8' });
    const parts  = output.split('\n')[1].split(/\s+/);
    const total  = parseInt(parts[1]) * 1024;
    const used   = parseInt(parts[2]) * 1024;
    const free   = parseInt(parts[3]) * 1024;
    return {
      total_mb: Math.round(total / 1024 / 1024),
      used_mb:  Math.round(used  / 1024 / 1024),
      free_mb:  Math.round(free  / 1024 / 1024),
      used_pct: total > 0 ? Math.round((used / total) * 100) : 0,
    };
  } catch {
    return { total_mb: 0, used_mb: 0, free_mb: 0, used_pct: 0 };
  }
}

async function getCpuUsage(): Promise<number> {
  try {
    const readStat = () => {
      const line  = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
      const parts = line.split(/\s+/).slice(1).map(Number);
      const idle  = parts[3];
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };
    const s1 = readStat();
    await new Promise(r => setTimeout(r, 250));
    const s2 = readStat();
    const dIdle  = s2.idle  - s1.idle;
    const dTotal = s2.total - s1.total;
    return dTotal > 0 ? Math.round(((dTotal - dIdle) / dTotal) * 100) : 0;
  } catch {
    return 0;
  }
}

// ── System health ─────────────────────────────────────────────────────────
router.get('/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: [dbStats] } = await query<{ db_size: string; active_queries: string }>(
      `SELECT
        pg_size_pretty(pg_database_size(current_database())) AS db_size,
        (SELECT COUNT(*) FROM pg_stat_activity WHERE state = 'active') AS active_queries`
    );

    const { rows: endpoints } = await query(
      `SELECT id, name, aor, status, last_seen_at, last_error, last_latency_ms
       FROM intercom_endpoints WHERE enabled = TRUE ORDER BY name`
    );

    const { rows: tableSizes } = await query(
      `SELECT relname AS table,
              pg_size_pretty(pg_total_relation_size(relid)) AS size,
              n_live_tup AS rows
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(relid) DESC
       LIMIT 5`
    );

    // pbx-core reachability — genuinely new vs. WTNF, since ip-intercom's
    // actual "is the phone system up" signal lives in pbx-core's own
    // in-memory admin endpoint, not the DB. Same fetch+timeout pattern as
    // pbxCoreService.ts.
    let pbxCore: { reachable: boolean; registrations?: number; calls?: number; error?: string };
    try {
      const resp = await fetch(`${config.pbxBaseUrl}/status`, { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json() as { registrations: unknown[]; calls: unknown[] };
      pbxCore = { reachable: true, registrations: body.registrations.length, calls: body.calls.length };
    } catch (err) {
      pbxCore = { reachable: false, error: (err as Error).message };
    }

    const [cpuPct, memInfo, diskInfo] = await Promise.all([getCpuUsage(), Promise.resolve(getMemoryInfo()), Promise.resolve(getDiskInfo())]);
    const uptime = process.uptime();
    const mem    = process.memoryUsage();

    res.json({
      timestamp: new Date().toISOString(),
      backend: {
        uptime_seconds:  Math.round(uptime),
        uptime_human:    `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`,
        memory_mb:       Math.round(mem.heapUsed / 1024 / 1024),
        memory_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
        node_version:    process.version,
      },
      host: {
        hostname: os.hostname(),
        platform: os.platform(),
        arch:     os.arch(),
      },
      system: {
        cpu_pct:       cpuPct,
        cpu_count:     os.cpus().length,
        mem_used_mb:   memInfo.used_mb,
        mem_total_mb:  memInfo.total_mb,
        mem_free_mb:   memInfo.free_mb,
        mem_used_pct:  memInfo.used_pct,
        disk_used_mb:  diskInfo.used_mb,
        disk_total_mb: diskInfo.total_mb,
        disk_free_mb:  diskInfo.free_mb,
        disk_used_pct: diskInfo.used_pct,
      },
      endpoints,
      pbx_core: pbxCore,
      database: {
        size:           dbStats.db_size,
        active_queries: parseInt(dbStats.active_queries),
        table_sizes:    tableSizes,
      },
    });
  } catch (e) { next(e); }
});

// ── Audit log ─────────────────────────────────────────────────────────────
router.get('/audit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit as string || '100'), 500);
    const offset = parseInt(req.query.offset as string || '0');
    const entity = req.query.entity_type as string | undefined;
    const actor  = req.query.actor as string | undefined;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (entity) { conditions.push(`entity_type = $${i++}`); values.push(entity); }
    if (actor)  { conditions.push(`actor ILIKE $${i++}`);   values.push(`%${actor}%`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await query(
      `SELECT id, event_time, actor, entity_type, entity_id, action,
              before_state, after_state, metadata, source_ip
       FROM audit_log
       ${where}
       ORDER BY event_time DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset]
    );

    const { rows: [{ count }] } = await query<{ count: string }>(
      `SELECT COUNT(*) FROM audit_log ${where}`,
      values
    );

    res.json({ rows, total: parseInt(count), limit, offset });
  } catch (e) { next(e); }
});

// ── Container log viewer ──────────────────────────────────────────────────
// Talks to the podman API socket (mounted into this container, see
// docker-compose.yml + config.podmanSocketPath) directly over Node's http
// module — no podman CLI installed in the image, this project prefers a
// thin raw client over a heavy dependency for a single read-only call (same
// call pbx-core/src/admin.ts made for its own tiny HTTP surface).
const SERVICE_CONTAINERS: Record<string, string> = {
  postgres:             'intercom-postgres',
  'controller-backend': 'intercom-controller-backend',
  'controller-frontend': 'intercom-controller-frontend',
  'pbx-core':           'intercom-pbx-core',
  rtpengine:            'intercom-rtpengine',
  freeswitch:           'intercom-freeswitch',
};

// podman's libpod logs endpoint has been observed (this build) to return
// plain newline-delimited text, not docker-compat's 8-byte multiplexed
// frame header — but strip a frame header defensively if one shows up, so
// this doesn't silently render binary junk if that ever differs.
function stripMultiplexFraming(buf: Buffer): string {
  if (buf.length >= 8 && buf[0] <= 2 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    let out = '';
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const frameLen = buf.readUInt32BE(offset + 4);
      out += buf.toString('utf8', offset + 8, offset + 8 + frameLen);
      offset += 8 + frameLen;
    }
    return out;
  }
  return buf.toString('utf8');
}

function fetchContainerLogs(containerName: string, lines: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: config.podmanSocketPath,
      path: `/v4.0.0/libpod/containers/${containerName}/logs?stdout=true&stderr=true&tail=${lines}`,
      method: 'GET',
      timeout: 10_000,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`podman socket HTTP ${res.statusCode}`));
          return;
        }
        resolve(stripMultiplexFraming(Buffer.concat(chunks)));
      });
    });
    req.on('timeout', () => req.destroy(new Error('podman socket request timed out')));
    req.on('error', reject);
    req.end();
  });
}

router.get('/logs/:service', async (req: Request, res: Response, next: NextFunction) => {
  const containerName = SERVICE_CONTAINERS[req.params.service];
  if (!containerName) return res.status(404).json({ error: 'Unknown service' });

  try {
    const lineCount = Math.min(parseInt(req.query.lines as string || '100'), 1000);
    const output = await fetchContainerLogs(containerName, lineCount);
    const allLines = output.split('\n').filter(Boolean);
    const errors = allLines.filter(l =>
      l.toLowerCase().includes('error') || l.toLowerCase().includes('warn') || l.toLowerCase().includes('fatal')
    ).slice(-50);
    res.json({ lines: allLines, errors, service: req.params.service });
  } catch (e) { next(e); }
});

export default router;
