// src/routes/intercom.ts
import { Router } from 'express';
import { query } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/session';
import { startDirect, endSession, setPtt, startGroup } from '../services/pbxService';

const router = Router();
router.use(requireAuth);

// Start a direct intercom call
router.post('/direct', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { initiatorId, targetId } = req.body ?? {};
    const out = await startDirect(req.user!.email, initiatorId, targetId);
    res.status(201).json(out);
  } catch (err) { next(err); }
});

// Start a group page/talkback (Phase 2)
router.post('/groups/:id/start', requireRole('admin', 'editor'), async (req, res, next) => {
  try { res.json(await startGroup(req.user!.email, req.params.id)); } catch (err) { next(err); }
});

// PTT floor control for a participant
router.post('/sessions/:id/ptt', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { endpointId, muted } = req.body ?? {};
    await setPtt(req.user!.email, req.params.id, endpointId, !!muted);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// End a session
router.post('/sessions/:id/end', requireRole('admin', 'editor'), async (req, res, next) => {
  try { await endSession(req.user!.email, req.params.id, req.body?.reason); res.json({ ok: true }); }
  catch (err) { next(err); }
});

// Session history
router.get('/sessions', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT s.*,
              COALESCE(i.name, di.name) AS initiator_name,
              COALESCE(t.name, dt.name) AS target_name,
              g.name AS group_name
       FROM intercom_sessions s
       LEFT JOIN intercom_endpoints i ON i.id = s.initiator_endpoint_id
       LEFT JOIN intercom_endpoints t ON t.id = s.target_endpoint_id
       LEFT JOIN intercom_directory_users di ON di.id = s.initiator_directory_user_id
       LEFT JOIN intercom_directory_users dt ON dt.id = s.target_directory_user_id
       LEFT JOIN intercom_groups    g ON g.id = s.group_id
       ORDER BY s.started_at DESC LIMIT 200`);
    res.json(rows);
  } catch (err) { next(err); }
});

// Participants of a session (with PTT floor / mute state)
router.get('/sessions/:id/participants', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.endpoint_id, e.name AS endpoint_name, p.muted, p.joined_at, p.left_at
       FROM intercom_session_participants p
       JOIN intercom_endpoints e ON e.id = p.endpoint_id
       WHERE p.session_id = $1
       ORDER BY e.name`, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

export default router;
