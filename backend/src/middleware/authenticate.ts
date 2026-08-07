import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { extractBearerToken } from '../utils/bearer-token.js';
import { JwtService } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';

/**
 * Bearer access-token authentication (Auth-Design §9.1).
 *
 * Extracts `Authorization: Bearer <token>`, verifies it (pinned HS256, `type:
 * access`, UUID `sub`) and attaches the identity to `req.user` as `{ id, email }`.
 * No database hit — the JWT is the sole source of the identity, so this stays on
 * the hot path. Missing/malformed headers are 401 AUTH_REQUIRED; an unverifiable
 * token yields AUTH_TOKEN_EXPIRED / AUTH_INVALID_TOKEN from JwtService, which the
 * centralized error handler turns into the standard envelope.
 */
const jwt = new JwtService(env.JWT_SECRET);

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    logger.warn({ requestId: req.id }, 'protected route reached without a bearer token');
    next(new AppError(401, 'AUTH_REQUIRED', 'Authentication required'));
    return;
  }

  try {
    const claims = await jwt.verify(token);
    req.user = { id: claims.sub, email: claims.email };
    next();
  } catch (err) {
    const code = err instanceof AppError ? err.code : 'AUTH_INVALID_TOKEN';
    logger.warn({ requestId: req.id, code }, 'access token rejected');
    next(err);
  }
}
