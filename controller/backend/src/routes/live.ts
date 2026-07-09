// src/routes/live.ts
// Read-only "what's true right now" status for the console's Live view —
// registrations + in-progress calls, polled live from pbx-core. See
// services/pbxCoreService.ts.
import { Router } from 'express';
import { requireAuth } from '../middleware/session';
import * as pbxCore from '../services/pbxCoreService';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try { res.json(await pbxCore.getLiveStatus()); } catch (err) { next(err); }
});

export default router;
