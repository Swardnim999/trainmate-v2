import type { Message, LastRead, PrismaClient } from '@prisma/client';
import { MessageRepository } from '../repositories/messages.repo.js';
import { LastReadRepository } from '../repositories/last-read.repo.js';
import { ConversationRepository } from '../repositories/conversations.repo.js';
import { ProfileRepository } from '../repositories/profiles.repo.js';
import { AccessService } from './access.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { prisma } from '../lib/prisma.js';

export interface SendMessageDto {
  text: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
}

export interface MessageServiceDeps {
  messages?: MessageRepository;
  lastRead?: LastReadRepository;
  conversations?: ConversationRepository;
  profiles?: ProfileRepository;
  access?: AccessService;
  db?: PrismaClient;
}

/**
 * MessageService — Business logic for messages, atomic sends, read receipts, and unread counts
 * (Spec §3.2, §6.5, §6.6, §9.6; Messages-Design §11).
 */
export class MessageService {
  private readonly messages: MessageRepository;
  private readonly lastRead: LastReadRepository;
  private readonly conversations: ConversationRepository;
  private readonly profiles: ProfileRepository;
  private readonly access: AccessService;
  private readonly db: PrismaClient;

  constructor(deps: Partial<MessageServiceDeps> = {}) {
    this.db = deps.db ?? prisma;
    this.messages = deps.messages ?? new MessageRepository(this.db);
    this.lastRead = deps.lastRead ?? new LastReadRepository(this.db);
    this.conversations = deps.conversations ?? new ConversationRepository(this.db);
    this.profiles = deps.profiles ?? new ProfileRepository(this.db);
    this.access = deps.access ?? new AccessService({ db: this.db });
  }

  /**
   * Retrieves message history for a conversation in chronological order (GET /conversations/:id/messages).
   * Masks existence with 404 for non-participants.
   */
  async listMessages(
    callerId: string,
    conversationId: string,
    limit = 100,
    before?: Date,
  ): Promise<Message[]> {
    const conv = await this.conversations.findById(conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    return this.messages.findByConversationId(conversationId, limit, before);
  }

  /**
   * Sends a message (text and/or attachment) atomically inside a single database transaction
   * and updates conversation preview and last_message_time (POST /conversations/:id/messages).
   *
   * Business Rules:
   * 1. Caller must be a conversation participant (404 masked for non-participants).
   * 2. Neither participant is blocked (AccessService.isBlocked).
   * 3. Sender identity is forced from authenticated caller (req.user.id).
   * 4. Single atomic transaction guarantees message insert + conversation preview update.
   */
  async sendMessage(
    callerId: string,
    conversationId: string,
    input: SendMessageDto,
  ): Promise<Message> {
    const conv = await this.conversations.findById(conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    const otherUserId = conv.participants.find((id) => id !== callerId)!;

    // Check symmetric blocking
    const blocked = await this.access.isBlocked(callerId, otherUserId);
    if (blocked) {
      throw new AppError(400, 'USER_BLOCKED', 'Cannot send message to this user');
    }

    // Resolve sender display name
    const senderProfile = await this.profiles.findById(callerId);
    const displayName = senderProfile?.name || 'User';

    const preview = input.attachmentUrl
      ? input.attachmentType?.startsWith('image/')
        ? '📷 Photo'
        : `📎 ${input.attachmentName || 'Attachment'}`
      : input.text;

    // Atomic transaction: Insert message + bump conversation preview
    return this.db.$transaction(async (tx) => {
      const message = await this.messages.createInTx(
        {
          conversationId,
          senderId: callerId,
          senderName: displayName,
          text: input.text,
          attachmentUrl: input.attachmentUrl,
          attachmentType: input.attachmentType,
          attachmentName: input.attachmentName,
          attachmentSize:
            input.attachmentSize !== undefined && input.attachmentSize !== null
              ? BigInt(input.attachmentSize)
              : null,
        },
        tx,
      );

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessage: preview.substring(0, 255),
          lastMessageTime: message.createdAt,
        },
      });

      return message;
    });
  }

  /**
   * Retrieves unread message count for caller in a conversation (GET /conversations/:id/messages/unread-count).
   */
  async getUnreadCount(callerId: string, conversationId: string): Promise<number> {
    const conv = await this.conversations.findById(conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    const lastRead = await this.lastRead.findByUserAndConversation(callerId, conversationId);
    return this.messages.countUnreadMessages(conversationId, callerId, lastRead?.timestamp ?? null);
  }

  /**
   * Retrieves a participant's last_read receipt in a conversation (GET /conversations/:id/last-read/:userId).
   */
  async getLastRead(
    callerId: string,
    conversationId: string,
    targetUserId: string,
  ): Promise<LastRead | null> {
    const conv = await this.conversations.findById(conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    if (!conv.participants.includes(targetUserId)) {
      throw new NotFoundError('User is not a participant in this conversation');
    }

    return this.lastRead.findByUserAndConversation(targetUserId, conversationId);
  }

  /**
   * Upserts the caller's last_read receipt for a conversation (PUT /conversations/:id/last-read).
   */
  async markAsRead(callerId: string, conversationId: string): Promise<LastRead> {
    const conv = await this.conversations.findById(conversationId);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    return this.lastRead.upsert(callerId, conversationId, new Date());
  }
}
