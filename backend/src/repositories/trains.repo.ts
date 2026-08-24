import type { Prisma, PrismaClient, Train } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Data access layer for `trains` reference table (Spec §3.2, §9.3; Journeys-Design §8.2).
 * Thin Prisma wrapper with zero business logic.
 */
export class TrainRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a train by primary key (trainNumber). */
  findByNumber(trainNumber: string): Promise<Train | null> {
    return this.db.train.findUnique({
      where: { trainNumber },
    });
  }

  /**
   * Searches active trains matching query string in trainNumber or trainName.
   * Matches case-insensitively and returns up to `limit` records (default 15).
   */
  search(query: string, limit: number = 15): Promise<Train[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return Promise.resolve([]);
    }

    return this.db.train.findMany({
      where: {
        active: true,
        OR: [
          { trainNumber: { contains: trimmed, mode: 'insensitive' } },
          { trainName: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ trainNumber: 'asc' }],
      take: limit,
    });
  }

  /**
   * Upserts or inserts a train entry.
   */
  upsert(trainNumber: string, trainName: string, active: boolean = true): Promise<Train> {
    return this.db.train.upsert({
      where: { trainNumber },
      create: { trainNumber, trainName, active },
      update: { trainName, active },
    });
  }
}
