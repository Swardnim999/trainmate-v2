import type { Request, Response } from 'express';
import { ConversationService } from '../services/conversation.service.js';
import { ConversationSerializer } from '../serializers/conversation.serializer.js';
import { validated } from '../middleware/validate.js';
import type { CreateConversationInput } from '../validation/conversation.schemas.js';

export interface ConversationControllerDeps {
  conversationService?: ConversationService;
}

/**
 * Conversation HTTP Controller (Milestone 10).
 * Thin controller extracting parameters and delegating to ConversationService.
 */
export class ConversationController {
  private readonly conversationService: ConversationService;

  constructor(deps: ConversationControllerDeps = {}) {
    this.conversationService = deps.conversationService ?? new ConversationService();
  }

  getMyConversations = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const conversations = await this.conversationService.listConversations(userId);
    res.status(200).json(ConversationSerializer.toResponseList(conversations));
  };

  getConversationById = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id } = validated<{ id: string }>(req, 'params');
    const conversation = await this.conversationService.getConversation(userId, id);
    res.status(200).json(ConversationSerializer.toResponse(conversation));
  };

  createConversation = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const input = validated<CreateConversationInput>(req, 'body');
    const conversation = await this.conversationService.createConversation(userId, input);
    res.status(201).json(ConversationSerializer.toResponse(conversation));
  };

  softDeleteForMe = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id } = validated<{ id: string }>(req, 'params');
    await this.conversationService.softDeleteForUser(userId, id);
    res.status(204).send();
  };
}
