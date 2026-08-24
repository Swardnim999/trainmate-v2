import type { Request, Response } from 'express';
import { MessageService } from '../services/message.service.js';
import { MessageSerializer } from '../serializers/message.serializer.js';
import { validated } from '../middleware/validate.js';
import type { SendMessageInput, ListMessagesQueryInput } from '../validation/message.schemas.js';

export interface MessageControllerDeps {
  messageService?: MessageService;
}

/**
 * Message HTTP Controller (Milestone 11).
 * Thin controller extracting parameters and delegating to MessageService.
 */
export class MessageController {
  private readonly messageService: MessageService;

  constructor(deps: MessageControllerDeps = {}) {
    this.messageService = deps.messageService ?? new MessageService();
  }

  listMessages = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id: conversationId } = validated<{ id: string }>(req, 'params');
    const query = validated<ListMessagesQueryInput>(req, 'query');
    const beforeDate = query.before ? new Date(query.before) : undefined;

    const messages = await this.messageService.listMessages(
      userId,
      conversationId,
      query.limit,
      beforeDate,
    );
    res.status(200).json(MessageSerializer.toResponseList(messages));
  };

  sendMessage = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id: conversationId } = validated<{ id: string }>(req, 'params');
    const input = validated<SendMessageInput>(req, 'body');

    const message = await this.messageService.sendMessage(userId, conversationId, input);
    res.status(201).json(MessageSerializer.toResponse(message));
  };

  getUnreadCount = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id: conversationId } = validated<{ id: string }>(req, 'params');

    const count = await this.messageService.getUnreadCount(userId, conversationId);
    res.status(200).json(MessageSerializer.toUnreadCountResponse(count));
  };

  getLastRead = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id: conversationId, userId: targetUserId } = validated<{
      id: string;
      userId: string;
    }>(req, 'params');

    const lastRead = await this.messageService.getLastRead(userId, conversationId, targetUserId);
    res.status(200).json(MessageSerializer.toLastReadResponse(lastRead));
  };

  markAsRead = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id: conversationId } = validated<{ id: string }>(req, 'params');

    const lastRead = await this.messageService.markAsRead(userId, conversationId);
    res.status(200).json(MessageSerializer.toLastReadResponse(lastRead));
  };
}
