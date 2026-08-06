import type { NextFunction, Request, Response } from 'express';

/**
 * Phase 3 skeleton. Returns the real limiter middleware once rate limiting is
 * wired. For Sprint 1 it is a transparent no-op so route code can mount it
 * today without shipping any traffic shaping. Not mounted anywhere yet.
 */
export function createRateLimiter(): (req: Request, res: Response, next: NextFunction) => void {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
}
