import { Router } from 'express';
import { ConversationController } from '../controllers/conversation.controller.js';
import { MessageController } from '../controllers/message.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createConversationSchema,
  conversationIdParamSchema,
} from '../validation/conversation.schemas.js';
import {
  sendMessageSchema,
  lastReadParamSchema,
  listMessagesQuerySchema,
} from '../validation/message.schemas.js';

export interface ConversationRouterDeps {
  conversationController?: ConversationController;
  messageController?: MessageController;
}

/**
 * Creates and mounts the Express router for /conversations endpoints (Spec §10.5, §10.6, §10.7; Roadmap Phase 10 & 11).
 */
export function createConversationRouter(deps: ConversationRouterDeps = {}): Router {
  const router = Router();
  const conversationController = deps.conversationController ?? new ConversationController();
  const messageController = deps.messageController ?? new MessageController();

  router.use(authenticate);

  // Conversations endpoints (M10)
  router.get('/', conversationController.getMyConversations);
  router.post(
    '/',
    validateBody(createConversationSchema),
    conversationController.createConversation,
  );
  router.get(
    '/:id',
    validateParams(conversationIdParamSchema),
    conversationController.getConversationById,
  );
  router.delete(
    '/:id/for-me',
    validateParams(conversationIdParamSchema),
    conversationController.softDeleteForMe,
  );

  // Messages & Read Receipts endpoints (M11)
  router.get(
    '/:id/messages',
    validateParams(conversationIdParamSchema),
    validateQuery(listMessagesQuerySchema),
    messageController.listMessages,
  );
  router.post(
    '/:id/messages',
    validateParams(conversationIdParamSchema),
    validateBody(sendMessageSchema),
    messageController.sendMessage,
  );
  router.get(
    '/:id/messages/unread-count',
    validateParams(conversationIdParamSchema),
    messageController.getUnreadCount,
  );
  router.get(
    '/:id/last-read/:userId',
    validateParams(lastReadParamSchema),
    messageController.getLastRead,
  );
  router.put(
    '/:id/last-read',
    validateParams(conversationIdParamSchema),
    messageController.markAsRead,
  );

  return router;
}
