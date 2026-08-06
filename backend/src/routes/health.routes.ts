import { Router } from 'express';
import { APP_VERSION, SERVICE_NAME } from '../config/constants.js';

export const healthRouter = Router();

/**
 * GET /health — liveness probe. The only endpoint in Sprint 1.
 * `/health/ready` (DB reachability) arrives with DB wiring in Phase 2.
 */
healthRouter.get('/', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: SERVICE_NAME,
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
