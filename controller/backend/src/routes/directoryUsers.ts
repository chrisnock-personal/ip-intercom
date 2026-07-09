// src/routes/directoryUsers.ts
import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/session';
import { audit } from '../services/auditService';
import * as directoryUsers from '../services/directoryUserService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try { res.json(await directoryUsers.listDirectoryUsers()); } catch (err) { next(err); }
});

router.post('/', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const u = await directoryUsers.createDirectoryUser(req.user!.email, req.body ?? {});
    await audit(req.user!.email, 'directory_user', u.id, 'create', { name: u.name, extension: u.extension });
    res.status(201).json(u);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try { res.json(await directoryUsers.getDirectoryUser(req.params.id)); } catch (err) { next(err); }
});

router.patch('/:id', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const u = await directoryUsers.updateDirectoryUser(req.user!.email, req.params.id, req.body ?? {});
    await audit(req.user!.email, 'directory_user', u.id, 'update', req.body);
    res.json(u);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await directoryUsers.deleteDirectoryUser(req.params.id);
    await audit(req.user!.email, 'directory_user', req.params.id, 'delete');
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Resetting a login credential is more sensitive than the rest of directory-
// user CRUD — admin only, unlike create/update/button management.
router.post('/:id/reset-password', requireRole('admin'), async (req, res, next) => {
  try {
    const { password } = req.body ?? {};
    await directoryUsers.resetPassword(req.params.id, password);
    await audit(req.user!.email, 'directory_user', req.params.id, 'update', { action: 'reset-password' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/buttons', async (req, res, next) => {
  try { res.json(await directoryUsers.listButtons(req.params.id)); } catch (err) { next(err); }
});

router.post('/:id/buttons', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const b = await directoryUsers.addButton(req.params.id, req.body ?? {});
    await audit(req.user!.email, 'directory_user', req.params.id, 'update', { added_button: b.id });
    res.status(201).json(b);
  } catch (err) { next(err); }
});

router.delete('/:id/buttons/:buttonId', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    await directoryUsers.removeButton(req.params.id, req.params.buttonId);
    await audit(req.user!.email, 'directory_user', req.params.id, 'update', { removed_button: req.params.buttonId });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
