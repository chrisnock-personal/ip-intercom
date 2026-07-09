// src/middleware/turretSession.ts
// Turret login is a SEPARATE auth path from the console operator session
// (session.ts) — a directory user (a person answering calls at a desk) has
// no console role/permissions. Both token kinds are signed with the same
// JWT_SECRET, so the `scope` discriminator below is a one-line but real
// hardening step: without it, a console operator's JWT would silently pass
// requireTurretAuth and vice versa.
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';

export interface TurretSessionUser {
  id: string;
  extension: string;
  name: string;
  scope: 'turret';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { turretUser?: TurretSessionUser; } }
}

function extractToken(req: Request): string | null {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.intercom_turret_session;
  if (cookie) return cookie;
  const auth = req.headers['authorization'];
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function requireTurretAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) { res.status(401).json({ error: 'Unauthorised' }); return; }
    const payload = jwt.verify(token, config.jwtSecret) as TurretSessionUser;
    if (payload.scope !== 'turret') { res.status(401).json({ error: 'Invalid session' }); return; }
    req.turretUser = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
}

export function signTurretToken(user: Omit<TurretSessionUser, 'scope'>): string {
  return jwt.sign({ ...user, scope: 'turret' }, config.jwtSecret, { expiresIn: config.jwtTtl } as jwt.SignOptions);
}
