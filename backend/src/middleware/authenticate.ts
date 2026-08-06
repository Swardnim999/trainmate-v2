import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors.js';

/**
 * Phase 3 skeleton. Once JWT auth lands, this verifies the access token and
 * attaches the verified identity to `req.user`. Until then it always rejects —
 * a protected route without this working is a 401, never an open door. Not
 * mounted anywhere in Sprint 1 (there are no protected routes yet).
 */
export function authenticate(_req: Request, _res: Response, next: NextFunction): void {
  next(
    new AppError(
      401,
      'AUTH_NOT_IMPLEMENTED',
      'Authentication is not implemented yet (expected in Phase 3)',
    ),
  );
}
