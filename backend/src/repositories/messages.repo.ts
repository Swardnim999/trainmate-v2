import type { Message, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateMessageData {
  conversationId: string;
  senderId: string;
  senderName?: string | null;
  text: string;
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  attachmentName?: string | null;
  attachmentSize?: bigint | null;
}

/**
 * Data access layer for `messages` (Spec §3.2, §6.5, §9.6; Messages-Design §11).
 * Thin Prisma wrapper with zero business logic.
 */
export class MessageRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a message by primary key ID. */
  findById(id: string): Promise<Message | null> {
    return this.db.message.findUnique({
      where: { id },
    });
  }

  /**
   * Retrieves message history for a conversation ordered chronologically (createdAt ASC).
   * Optional pagination via `before` cursor and `limit`.
   */
  findByConversationId(conversationId: string, limit = 100, before?: Date): Promise<Message[]> {
    const where: Prisma.MessageWhereInput = {
      conversationId,
    };

    if (before) {
      where.createdAt = { lt: before };
    }

    return this.db.message.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
      take: limit,
    });
  }

  /**
   * Counts unread messages in a conversation for a user.
   * Messages authored by the user are excluded (senderId != userId).
   * If lastReadTimestamp is null, counts all messages authored by others.
   */
  async countUnreadMessages(
    conversationId: string,
    userId: string,
    lastReadTimestamp: Date | null,
  ): Promise<number> {
    const where: Prisma.MessageWhereInput = {
      conversationId,
      senderId: { not: userId },
    };

    if (lastReadTimestamp) {
      where.createdAt = { gt: lastReadTimestamp };
    }

    return this.db.message.count({
      where,
    });
  }

  /**
   * Creates a new message row inside a transaction client.
   */
  createInTx(data: CreateMessageData, tx: Prisma.TransactionClient): Promise<Message> {
    return tx.message.create({
      data: {
        conversationId: data.conversationId,
        senderId: data.senderId,
        senderName: data.senderName ?? null,
        text: data.text,
        attachmentUrl: data.attachmentUrl ?? null,
        attachmentType: data.attachmentType ?? null,
        attachmentName: data.attachmentName ?? null,
        attachmentSize: data.attachmentSize ?? null,
      },
    });
  }
}
