import { Router } from 'express';
import { ConversationController } from '../controllers/conversation.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  createConversationSchema,
  conversationIdParamSchema,
} from '../validation/conversation.schemas.js';

export interface ConversationRouterDeps {
  conversationController?: ConversationController;
}

/**
 * Creates and mounts the Express router for /conversations endpoints (Spec §10.5; Roadmap Phase 10).
 */
export function createConversationRouter(deps: ConversationRouterDeps = {}): Router {
  const router = Router();
  const controller = deps.conversationController ?? new ConversationController();

  router.use(authenticate);

  router.get('/', controller.getMyConversations);
  router.post('/', validateBody(createConversationSchema), controller.createConversation);
  router.get('/:id', validateParams(conversationIdParamSchema), controller.getConversationById);
  router.delete(
    '/:id/for-me',
    validateParams(conversationIdParamSchema),
    controller.softDeleteForMe,
  );

  return router;
}
