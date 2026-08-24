import type { LastRead, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access layer for `last_read` read receipts (Spec §3.2, §6.6, §9.6; Messages-Design §11).
 * Thin Prisma wrapper with zero business logic.
 */
export class LastReadRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a last_read record by compound unique key (userId, conversationId). */
  findByUserAndConversation(userId: string, conversationId: string): Promise<LastRead | null> {
    return this.db.lastRead.findUnique({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
    });
  }

  /**
   * Upserts the caller's last_read receipt timestamp for a conversation.
   */
  upsert(userId: string, conversationId: string, timestamp: Date = new Date()): Promise<LastRead> {
    return this.db.lastRead.upsert({
      where: {
        userId_conversationId: {
          userId,
          conversationId,
        },
      },
      create: {
        userId,
        conversationId,
        timestamp,
      },
      update: {
        timestamp,
      },
    });
  }
}
