import type { Conversation, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateConversationData {
  participants: string[];
  participantNames?: Record<string, string>;
  trainNumber?: string | null;
  travelDate?: Date | null;
  lastMessage?: string | null;
  lastMessageTime?: Date | null;
}

/**
 * Data access layer for `conversations` (Spec §3.2, §6.4, §9.5; Conversations-Design §11.1).
 * Thin Prisma wrapper with zero business logic.
 */
export class ConversationRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a conversation by primary key ID. */
  findById(id: string): Promise<Conversation | null> {
    return this.db.conversation.findUnique({
      where: { id },
    });
  }

  /**
   * Retrieves all active conversations for a user, excluding conversations
   * that have been soft-deleted by this user (`deletedFor` array).
   * Ordered by `lastMessageTime` descending.
   */
  findUserConversations(userId: string): Promise<Conversation[]> {
    return this.db.conversation.findMany({
      where: {
        participants: {
          has: userId,
        },
        NOT: {
          deletedFor: {
            has: userId,
          },
        },
      },
      orderBy: [{ lastMessageTime: 'desc' }],
    });
  }

  /**
   * Checks if an existing conversation exists between two participants,
   * optionally matching the same train number and travel date context.
   */
  findExistingBetween(
    userA: string,
    userB: string,
    trainNumber?: string | null,
    travelDate?: Date | null,
  ): Promise<Conversation | null> {
    const where: Prisma.ConversationWhereInput = {
      participants: {
        hasEvery: [userA, userB],
      },
    };

    if (trainNumber !== undefined) {
      where.trainNumber = trainNumber;
    }
    if (travelDate !== undefined) {
      where.travelDate = travelDate;
    }

    return this.db.conversation.findFirst({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /**
   * Creates a new conversation room.
   */
  create(data: CreateConversationData, tx?: Prisma.TransactionClient): Promise<Conversation> {
    const client = tx ?? this.db;
    return client.conversation.create({
      data: {
        participants: data.participants,
        participantNames: data.participantNames ?? {},
        trainNumber: data.trainNumber ?? null,
        travelDate: data.travelDate ?? null,
        lastMessage: data.lastMessage ?? '',
        lastMessageTime: data.lastMessageTime ?? new Date(),
        deletedFor: [],
      },
    });
  }

  /**
   * Atomically appends a user's ID to `deleted_for` array if the user is a participant.
   * Duplicate guard prevents duplicate entries.
   * Returns true if the conversation exists and caller is a participant.
   */
  async softDeleteForUser(id: string, userId: string): Promise<boolean> {
    const rowsUpdated = await (this.db as PrismaClient).$executeRaw`
      UPDATE "conversations"
      SET "deleted_for" = array_append(COALESCE("deleted_for", ARRAY[]::uuid[]), ${userId}::uuid)
      WHERE "id" = ${id}::uuid
        AND ${userId}::uuid = ANY("participants")
        AND NOT (${userId}::uuid = ANY(COALESCE("deleted_for", ARRAY[]::uuid[])))
    `;

    if (rowsUpdated > 0) {
      return true;
    }

    // If rowsUpdated === 0, check if already in deleted_for or invalid
    const conv = await this.findById(id);
    if (!conv || !conv.participants.includes(userId)) {
      return false;
    }

    return true; // Already deleted_for this user
  }

  /**
   * Updates last_message preview and last_message_time timestamp.
   * Internal method called during message dispatch (M11 seam).
   */
  async updateLastMessage(id: string, lastMessage: string, lastMessageTime: Date): Promise<void> {
    await this.db.conversation.update({
      where: { id },
      data: {
        lastMessage,
        lastMessageTime,
      },
    });
  }
}
