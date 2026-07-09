// src/routes/groups.ts
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/session';
import { audit } from '../services/auditService';
import * as groups from '../services/groupService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try { res.json(await groups.listGroups()); } catch (err) { next(err); }
});

router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const g = await groups.createGroup(req.user!.email, req.body ?? {});
    await audit(req.user!.email, 'group', g.id, 'create', { name: g.name });
    res.status(201).json(g);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try { res.json(await groups.getGroup(req.params.id)); } catch (err) { next(err); }
});

router.patch('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const g = await groups.updateGroup(req.user!.email, req.params.id, req.body ?? {});
    await audit(req.user!.email, 'group', g.id, 'update', req.body);
    res.json(g);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await groups.deleteGroup(req.params.id);
    await audit(req.user!.email, 'group', req.params.id, 'delete');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/members', async (req, res, next) => {
  try { res.json(await groups.listMembers(req.params.id)); } catch (err) { next(err); }
});

router.post('/:id/members', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const { endpointId, role, canTalk } = req.body ?? {};
    const m = await groups.addMember(req.params.id, endpointId, role, canTalk ?? true);
    await audit(req.user!.email, 'group', req.params.id, 'update', { added: endpointId });
    res.status(201).json(m);
  } catch (err) { next(err); }
});

router.delete('/:id/members/:endpointId', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    await groups.removeMember(req.params.id, req.params.endpointId);
    await audit(req.user!.email, 'group', req.params.id, 'update', { removed: req.params.endpointId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
