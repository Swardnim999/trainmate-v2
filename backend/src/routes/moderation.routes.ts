import { Router } from 'express';
import { ModerationController } from '../controllers/moderation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { ModerationService } from '../services/moderation.service.js';
import {
  blockUserSchema,
  reportUserSchema,
  unblockParamsSchema,
} from '../validation/moderation.schemas.js';

export interface ModerationRouterDeps {
  moderation?: ModerationService;
}

/**
 * Moderation and blocking routes (Moderation-Design §8.1).
 * Mounts:
 * - GET /blocked-users
 * - POST /blocked-users
 * - DELETE /blocked-users/:blockedId
 * - POST /reports
 */
export function createModerationRouter(deps: ModerationRouterDeps = {}): Router {
  const router = Router();
  const service = deps.moderation ?? new ModerationService();
  const controller = new ModerationController({ moderation: service });

  router.get('/blocked-users', authenticate, controller.getBlockedUsers);

  router.post('/blocked-users', authenticate, validateBody(blockUserSchema), controller.blockUser);

  router.delete(
    '/blocked-users/:blockedId',
    authenticate,
    validateParams(unblockParamsSchema),
    controller.unblockUser,
  );

  router.post('/reports', authenticate, validateBody(reportUserSchema), controller.reportUser);

  return router;
}
