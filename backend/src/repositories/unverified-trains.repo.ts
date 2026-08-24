import type { Prisma, PrismaClient, UnverifiedTrain } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateUnverifiedTrainData {
  trainNumber: string;
  trainName?: string | null;
  submittedBy?: string | null;
  enteredValue?: string | null;
  normalizedValue?: string | null;
}

/**
 * Data access layer for `unverified_trains` table (Spec §3.2, §9.3; Journeys-Design §8.3).
 * Thin Prisma wrapper with zero business logic.
 */
export class UnverifiedTrainRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds an unverified train entry by ID. */
  findById(id: string): Promise<UnverifiedTrain | null> {
    return this.db.unverifiedTrain.findUnique({
      where: { id },
    });
  }

  /**
   * Logs a new unverified train entry. Supports transactional execution.
   */
  create(data: CreateUnverifiedTrainData, tx?: Prisma.TransactionClient): Promise<UnverifiedTrain> {
    const client = tx ?? this.db;
    return client.unverifiedTrain.create({
      data: {
        trainNumber: data.trainNumber,
        trainName: data.trainName ?? null,
        submittedBy: data.submittedBy ?? null,
        enteredValue: data.enteredValue ?? null,
        normalizedValue: data.normalizedValue ?? null,
      },
    });
  }

  /** Finds unverified train entries submitted by a specific user. */
  findBySubmittedBy(submittedBy: string): Promise<UnverifiedTrain[]> {
    return this.db.unverifiedTrain.findMany({
      where: { submittedBy },
      orderBy: [{ createdAt: 'desc' }],
    });
  }
}
