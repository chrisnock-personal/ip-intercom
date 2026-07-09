// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error { statusCode?: number; code?: string; }

export function createError(message: string, statusCode = 400, code?: string): AppError {
  const err: AppError = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.statusCode ?? 500;
  if (status >= 500) console.error('[error]', err.message, err.stack);
  res.status(status).json({ error: err.message || 'Internal server error', code: err.code });
}
