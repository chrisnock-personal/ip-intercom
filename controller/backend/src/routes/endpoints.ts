// src/routes/endpoints.ts
import { Router } from 'express';
import { query, queryOne } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/session';
import { audit } from '../services/auditService';
import { runHealthChecks } from '../services/endpointHealthService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, name, aor, rest_url, kind, enabled, status, last_seen_at, last_error, last_latency_ms
       FROM intercom_endpoints ORDER BY name`);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { name, aor, rest_url, kind } = req.body ?? {};
    const ep = await queryOne(
      `INSERT INTO intercom_endpoints (name, aor, rest_url, kind, created_by, updated_by)
       VALUES ($1,$2,$3,COALESCE($4,'station'),$5,$5)
       RETURNING id, name, aor, rest_url, kind, enabled, status`,
      [name, aor, rest_url ?? null, kind ?? null, req.user!.email]);
    await audit(req.user!.email, 'endpoint', (ep as { id: string }).id, 'create', { name });
    res.status(201).json(ep);
  } catch (err) { next(err); }
});

router.get('/:id/health', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT status, latency_ms, error_message, checked_at
       FROM intercom_endpoint_health_log WHERE endpoint_id = $1
       ORDER BY checked_at DESC LIMIT 200`, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/poll', requireRole('admin', 'editor'), async (_req, res, next) => {
  try { await runHealthChecks(); res.json({ ok: true }); } catch (err) { next(err); }
});

export default router;
