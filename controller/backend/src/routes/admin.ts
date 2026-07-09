// src/routes/admin.ts
// Database backup/restore/maintenance, admin-only. Ported from Walk the Nxt
// Floor's backend/src/routes/admin.ts, adapted for the one real
// architectural difference: WTNF runs backend+postgres in the same
// container (gosu postgres peer-auth over a local unix socket) — here
// postgres is a separate container reached over TCP, so pg_dump/psql are
// driven with -h/-p/-U + a PGPASSWORD env var instead.
import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { requireAuth, requireRole } from '../middleware/session';
import { query } from '../db/pool';
import { audit } from '../services/auditService';
import config from '../config';

const router = Router();
const adminOnly = requireRole('admin');
router.use(requireAuth, adminOnly);

const execAsync = promisify(exec);

function pgEnv(): NodeJS.ProcessEnv {
  // PGPASSWORD via env, never on the command line (would otherwise leak
  // into `ps`/process-listing output).
  return { ...process.env, PGPASSWORD: config.pgPassword };
}

function pgConnArgs(): string {
  return `-h ${config.pgHost} -p ${config.pgPort} -U ${config.pgUser} ${config.pgDatabase}`;
}

// ── Backup ──────────────────────────────────────────────────────────────────
router.post('/backup', async (req: Request, res: Response, next: NextFunction) => {
  const tmpFile = path.join(os.tmpdir(), `intercom-backup-${Date.now()}.sql`);
  try {
    await execAsync(`pg_dump ${pgConnArgs()} -f ${tmpFile}`, { env: pgEnv(), timeout: 120_000 });
    const stat = fs.statSync(tmpFile);
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="intercom-backup-${new Date().toISOString().slice(0,10)}.sql"`);
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(tmpFile);
    stream.pipe(res);
    stream.on('end', async () => {
      try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }
      await audit(req.user!.email, 'database', '00000000-0000-0000-0000-000000000000', 'update', { action: 'backup' });
    });
    stream.on('error', next);
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }
    next(e);
  }
});

// ── Restore ─────────────────────────────────────────────────────────────────
// Route-scoped raw-text body parser — deliberately not global, so every
// other route keeps using express.json() untouched. (WTNF's own comment on
// its equivalent route claims this wiring exists in its index.ts; it
// doesn't — this fixes that gap properly rather than repeating it.)
router.post('/restore', express.text({ type: '*/*', limit: '50mb' }),
  async (req: Request, res: Response, next: NextFunction) => {
    const tmpFile = path.join(os.tmpdir(), `intercom-restore-${Date.now()}.sql`);
    try {
      if (typeof req.body !== 'string' || !req.body.startsWith('--')) {
        throw new Error('Invalid backup file — must be a PostgreSQL SQL dump');
      }
      fs.writeFileSync(tmpFile, req.body);
      await execAsync(`psql ${pgConnArgs()} -f ${tmpFile}`, { env: pgEnv(), timeout: 300_000 });
      await audit(req.user!.email, 'database', '00000000-0000-0000-0000-000000000000', 'update', { action: 'restore' });
      res.json({ ok: true, message: 'Restore completed' });
    } catch (e) {
      next(e);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }
    }
  });

// ── Backup info ───────────────────────────────────────────────────────────
router.get('/backup/info', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows: [size] } = await query<{ size: string }>(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
    );
    const { rows: [counts] } = await query(
      `SELECT
        (SELECT COUNT(*) FROM intercom_endpoints)       AS endpoints,
        (SELECT COUNT(*) FROM intercom_groups)          AS groups,
        (SELECT COUNT(*) FROM intercom_directory_users) AS directory_users,
        (SELECT COUNT(*) FROM intercom_sessions)        AS sessions,
        (SELECT COUNT(*) FROM audit_log)                AS audit_log`
    );
    res.json({ db_size: size.size, counts });
  } catch (e) { next(e); }
});

// ── Database maintenance ────────────────────────────────────────────────────
router.get('/db/stats', async (_req, res, next) => {
  try {
    const { rows: tables } = await query(
      `SELECT relname AS table,
              pg_size_pretty(pg_total_relation_size(relid)) AS size,
              pg_total_relation_size(relid) AS size_bytes,
              n_live_tup AS rows,
              n_dead_tup AS dead_rows,
              last_vacuum, last_autovacuum, last_analyze
       FROM pg_stat_user_tables
       ORDER BY pg_total_relation_size(relid) DESC`
    );
    const { rows: [dbSize] } = await query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS size,
              pg_database_size(current_database()) AS size_bytes`
    );
    res.json({ tables, db_size: dbSize.size, db_size_bytes: dbSize.size_bytes });
  } catch (e) { next(e); }
});

router.post('/db/vacuum', async (req, res, next) => {
  try {
    await query('VACUUM ANALYZE');
    await audit(req.user!.email, 'database', '00000000-0000-0000-0000-000000000000', 'update', { action: 'vacuum' });
    res.json({ ok: true, message: 'VACUUM ANALYZE completed' });
  } catch (e) { next(e); }
});

// ── Purge (retention) ───────────────────────────────────────────────────────
// Whitelisted table names only — never interpolate an arbitrary client-
// supplied table name into SQL. intercom_endpoint_health_log already has
// its own automatic hourly prune (HEALTH_LOG_RETENTION_DAYS, see
// endpointHealthService.ts) and isn't offered here to avoid two retention
// mechanisms fighting over the same table.
const PURGEABLE_TABLES = ['audit_log', 'intercom_sessions'] as const;
type PurgeableTable = typeof PURGEABLE_TABLES[number];

router.post('/db/purge', async (req, res, next) => {
  try {
    const { table, days = 90 } = req.body as { table?: string; days?: number };
    if (!table || !PURGEABLE_TABLES.includes(table as PurgeableTable)) {
      return res.status(400).json({ error: `table must be one of: ${PURGEABLE_TABLES.join(', ')}` });
    }
    if (days < 30) return res.status(400).json({ error: 'Minimum retention is 30 days' });

    const { rowCount } = table === 'audit_log'
      ? await query(`DELETE FROM audit_log WHERE event_time < now() - ($1 || ' days')::interval`, [days])
      // Never purge a live session, regardless of age.
      : await query(`DELETE FROM intercom_sessions WHERE state != 'active' AND started_at < now() - ($1 || ' days')::interval`, [days]);

    await audit(req.user!.email, 'database', '00000000-0000-0000-0000-000000000000', 'delete', { action: 'purge', table, days, deleted: rowCount ?? 0 });
    res.json({ ok: true, deleted: rowCount ?? 0, message: `Purged ${table} rows older than ${days} days` });
  } catch (e) { next(e); }
});

// ── Archive + remote transfer ───────────────────────────────────────────────
router.post('/db/archive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days = 90, transfer } = req.body as {
      days?: number;
      transfer?: { type: 'scp' | 'sftp' | 'ftp' | 'local'; host?: string; port?: number; user?: string; path: string; key_path?: string };
    };
    const archiveName = `intercom-archive-${new Date().toISOString().slice(0,10)}-${days}d.sql.gz`;
    const tmpFile = path.join(os.tmpdir(), archiveName);

    await execAsync(
      `pg_dump ${pgConnArgs()} --table=audit_log --table=intercom_sessions --table=intercom_session_participants | gzip > ${tmpFile}`,
      { env: pgEnv(), timeout: 300_000 }
    );
    const stat = fs.statSync(tmpFile);
    let transferResult = 'No transfer configured';

    if (transfer) {
      const dest = transfer.path.endsWith('/') ? `${transfer.path}${archiveName}` : transfer.path;
      if (transfer.type === 'local') {
        fs.copyFileSync(tmpFile, dest);
        transferResult = `Copied to ${dest}`;
      } else if (transfer.type === 'scp') {
        const sshOpts = transfer.key_path
          ? `-i ${transfer.key_path} -o StrictHostKeyChecking=no`
          : `-o StrictHostKeyChecking=no -o PubkeyAuthentication=no`;
        const port = transfer.port ?? 22;
        await execAsync(`scp -P ${port} ${sshOpts} ${tmpFile} ${transfer.user}@${transfer.host}:${dest}`, { timeout: 120_000 });
        transferResult = `Transferred via SCP to ${transfer.host}:${dest}`;
      } else {
        transferResult = `Transfer type "${transfer.type}" not yet implemented`;
      }
    }

    try { fs.unlinkSync(tmpFile); } catch { /* best effort */ }
    await audit(req.user!.email, 'database', '00000000-0000-0000-0000-000000000000', 'update', { action: 'archive', days, transfer: transferResult });
    res.json({ ok: true, archive_name: archiveName, size_bytes: stat.size, transfer: transferResult });
  } catch (e) { next(e); }
});

export default router;
