import type { Prisma, PrismaClient, Request } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateRequestData {
  fromUserId: string;
  fromEmail?: string | null;
  fromName?: string | null;
  toUserId: string;
  toEmail?: string | null;
  toName?: string | null;
  trainNumber?: string | null;
  travelDate?: Date | null;
  boardingStation?: string | null;
  destinationStation?: string | null;
  status?: string;
}

export interface FindUserRequestsOptions {
  userId: string;
  type?: 'sent' | 'received' | 'all';
  status?: string;
  excludedUserIds?: string[];
}

/**
 * Data access layer for `requests` (Spec §3.2, §6.3, §9.4; Requests-Design §6).
 * Thin Prisma wrapper with zero business logic.
 */
export class RequestRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a request by primary key ID. */
  findById(id: string): Promise<Request | null> {
    return this.db.request.findUnique({
      where: { id },
    });
  }

  /**
   * Finds all requests for a user with optional type filtering ('sent' | 'received' | 'all'),
   * optional status filter, and symmetric blocked ID exclusions.
   * Ordered by createdAt descending.
   */
  findUserRequests(options: FindUserRequestsOptions): Promise<Request[]> {
    const { userId, type = 'all', status, excludedUserIds = [] } = options;

    let userCondition: Prisma.RequestWhereInput;

    if (type === 'sent') {
      userCondition = {
        fromUserId: userId,
        toUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
      };
    } else if (type === 'received') {
      userCondition = {
        toUserId: userId,
        fromUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
      };
    } else {
      // 'all' sent or received
      userCondition = {
        OR: [
          {
            fromUserId: userId,
            toUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
          },
          {
            toUserId: userId,
            fromUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
          },
        ],
      };
    }

    const where: Prisma.RequestWhereInput = {
      ...userCondition,
      status: status ?? undefined,
    };

    return this.db.request.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /**
   * Finds all accepted requests involving a user (sent or received),
   * excluding blocked user IDs.
   */
  findAcceptedRequestsForUser(userId: string, excludedUserIds: string[] = []): Promise<Request[]> {
    return this.db.request.findMany({
      where: {
        status: 'accepted',
        OR: [
          {
            fromUserId: userId,
            toUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
          },
          {
            toUserId: userId,
            fromUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /**
   * Finds an active pending request between two users for a specific train and travel date.
   */
  findActivePendingBetween(
    fromUserId: string,
    toUserId: string,
    trainNumber?: string | null,
    travelDate?: Date | null,
  ): Promise<Request | null> {
    const where: Prisma.RequestWhereInput = {
      fromUserId,
      toUserId,
      status: 'pending',
    };

    if (trainNumber !== undefined) {
      where.trainNumber = trainNumber;
    }
    if (travelDate !== undefined) {
      where.travelDate = travelDate;
    }

    return this.db.request.findFirst({
      where,
    });
  }

  /**
   * Checks if an accepted request exists between two users in either direction.
   * Consumed by AccessService for M7 profile access and M10 conversation creation.
   */
  findAcceptedRequestBetween(
    userA: string,
    userB: string,
    trainNumber?: string | null,
    travelDate?: Date | null,
  ): Promise<Request | null> {
    const where: Prisma.RequestWhereInput = {
      status: 'accepted',
      OR: [
        { fromUserId: userA, toUserId: userB },
        { fromUserId: userB, toUserId: userA },
      ],
    };

    if (trainNumber) {
      where.trainNumber = trainNumber;
    }
    if (travelDate) {
      where.travelDate = travelDate;
    }

    return this.db.request.findFirst({
      where,
    });
  }

  /**
   * Counts incoming pending requests for the Dashboard bell badge,
   * excluding blocked senders.
   */
  countIncomingPending(toUserId: string, excludedUserIds: string[] = []): Promise<number> {
    return this.db.request.count({
      where: {
        toUserId,
        status: 'pending',
        fromUserId: excludedUserIds.length > 0 ? { notIn: excludedUserIds } : undefined,
      },
    });
  }

  /**
   * Creates a new request record with default status 'pending'.
   */
  create(data: CreateRequestData, tx?: Prisma.TransactionClient): Promise<Request> {
    const client = tx ?? this.db;
    return client.request.create({
      data: {
        fromUserId: data.fromUserId,
        fromEmail: data.fromEmail ?? null,
        fromName: data.fromName ?? null,
        toUserId: data.toUserId,
        toEmail: data.toEmail ?? null,
        toName: data.toName ?? null,
        trainNumber: data.trainNumber ?? null,
        travelDate: data.travelDate ?? null,
        boardingStation: data.boardingStation ?? null,
        destinationStation: data.destinationStation ?? null,
        status: data.status ?? 'pending',
      },
    });
  }

  /**
   * Updates request status atomically.
   * Only transitions if current status matches expectedCurrentStatus ('pending').
   * Returns updated Request or null if no row matched.
   */
  async updateStatus(
    id: string,
    status: 'accepted' | 'rejected',
    expectedCurrentStatus: string = 'pending',
  ): Promise<Request | null> {
    const updated = await this.db.request.updateMany({
      where: {
        id,
        status: expectedCurrentStatus,
      },
      data: {
        status,
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.findById(id);
  }

  /**
   * Deletes a request only if it is in 'pending' status and owned by fromUserId (sender).
   * Returns true if a row was deleted, false otherwise.
   */
  async deletePendingByIdAndOwner(id: string, fromUserId: string): Promise<boolean> {
    const result = await this.db.request.deleteMany({
      where: {
        id,
        fromUserId,
        status: 'pending',
      },
    });
    return result.count > 0;
  }

  /**
   * Prunes expired pending requests where travelDate < cutoffDate.
   * If fromUserId is supplied, limits pruning to that user; otherwise prunes across all users.
   * Single atomic DELETE query. Returns the number of deleted rows.
   */
  async deleteExpiredPending(fromUserId?: string, cutoffDate?: Date): Promise<number> {
    const where: Prisma.RequestWhereInput = {
      status: 'pending',
    };
    if (fromUserId) {
      where.fromUserId = fromUserId;
    }
    if (cutoffDate) {
      where.travelDate = {
        lt: cutoffDate,
      };
    }
    const result = await this.db.request.deleteMany({
      where,
    });
    return result.count;
  }
}
