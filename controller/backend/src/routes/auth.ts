// src/routes/auth.ts
import { Router } from 'express';
import { authenticate, changePassword } from '../services/userService';
import { signToken, requireAuth } from '../middleware/session';
import { audit } from '../services/auditService';
import config from '../config';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {};
    const user = await authenticate(email, password);
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.cookie('intercom_session', token, {
      httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    });
    await audit(user.email, 'user', user.id, 'login');
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, password_changed: user.password_changed } });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res) => {
  res.clearCookie('intercom_session');
  await audit(req.user!.email, 'user', req.user!.id, 'logout');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    await changePassword(req.user!.id, currentPassword, newPassword);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
