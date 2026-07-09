// src/routes/turret.ts — login + self for the browser turret page.
import { Router } from 'express';
import config from '../config';
import { requireTurretAuth, signTurretToken } from '../middleware/turretSession';
import { authenticateDirectoryUser, listButtons } from '../services/directoryUserService';
import { audit } from '../services/auditService';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { extension, password } = req.body ?? {};
    if (!extension || !password) return res.status(400).json({ error: 'extension and password are required' });
    const user = await authenticateDirectoryUser(extension, password);
    const token = signTurretToken({ id: user.id, extension: user.extension, name: user.name });
    // Set for parity with the console's cookie pattern; the turret page
    // itself relies on the returned token (sessionStorage + Bearer), not
    // this cookie — see plan notes on hot-desk kiosk semantics.
    res.cookie('intercom_turret_session', token, {
      httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    });
    const buttons = await listButtons(user.id);
    await audit(user.extension, 'directory_user', user.id, 'login');
    res.json({
      token, name: user.name, extension: user.extension, buttons,
      pbxWsHost: config.pbxWsHost, pbxWsPort: config.pbxWsPort,
    });
  } catch (err) { next(err); }
});

router.post('/logout', requireTurretAuth, async (req, res) => {
  res.clearCookie('intercom_turret_session');
  await audit(req.turretUser!.extension, 'directory_user', req.turretUser!.id, 'logout');
  res.json({ ok: true });
});

router.get('/me', requireTurretAuth, async (req, res, next) => {
  try {
    const buttons = await listButtons(req.turretUser!.id);
    res.json({
      name: req.turretUser!.name, extension: req.turretUser!.extension, buttons,
      pbxWsHost: config.pbxWsHost, pbxWsPort: config.pbxWsPort,
    });
  } catch (err) { next(err); }
});

export default router;
