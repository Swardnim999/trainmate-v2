import type { BlockedUser, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateBlockData {
  id?: string;
  blockerId: string;
  blockedId: string;
}

/**
 * Data access for `blocked_users` (Moderation-Design §5.1). Thin CRUD only —
 * no business rules; those live in ModerationService and AccessService.
 * Returns typed results without leaking Prisma exceptions.
 */
export class BlockedUserRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a specific directional block row (blocker → blocked). */
  findByPair(blockerId: string, blockedId: string): Promise<BlockedUser | null> {
    return this.db.blockedUser.findUnique({
      where: {
        blockerId_blockedId: { blockerId, blockedId },
      },
    });
  }

  /**
   * Evaluates symmetric block existence between userA and userB.
   * Returns true if either userA blocked userB OR userB blocked userA.
   */
  async isBlocked(userA: string, userB: string): Promise<boolean> {
    const count = await this.db.blockedUser.count({
      where: {
        OR: [
          { blockerId: userA, blockedId: userB },
          { blockerId: userB, blockedId: userA },
        ],
      },
    });
    return count > 0;
  }

  /** Retrieves all user IDs explicitly blocked by blockerId. */
  async findBlockedIdsByBlocker(blockerId: string): Promise<string[]> {
    const rows = await this.db.blockedUser.findMany({
      where: { blockerId },
      select: { blockedId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.blockedId);
  }

  /**
   * Retrieves all user IDs having a symmetric blocking relationship with userId
   * (either blocked by userId OR blocking userId).
   */
  async findSymmetricBlockedIds(userId: string): Promise<string[]> {
    const rows = await this.db.blockedUser.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
      select: { blockerId: true, blockedId: true },
    });
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.blockerId === userId) {
        ids.add(r.blockedId);
      } else {
        ids.add(r.blockerId);
      }
    }
    return Array.from(ids);
  }

  /** Creates a block row. */
  create(data: CreateBlockData): Promise<BlockedUser> {
    return this.db.blockedUser.create({ data });
  }

  /**
   * Deletes a directional block row.
   * Returns true if a row was deleted, false if none existed.
   */
  async deleteByPair(blockerId: string, blockedId: string): Promise<boolean> {
    const { count } = await this.db.blockedUser.deleteMany({
      where: { blockerId, blockedId },
    });
    return count > 0;
  }
}
