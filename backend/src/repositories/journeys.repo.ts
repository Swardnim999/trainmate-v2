import type { Journey, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateJourneyData {
  userId: string;
  userName?: string | null;
  trainNumber: string;
  trainName?: string | null;
  travelDate: Date;
  coach?: string | null;
  boardingStation?: string | null;
  destinationStation?: string | null;
  college?: string | null;
  gender?: string | null;
}

/**
 * Data access layer for `journeys` (Spec §3.2, §6.2, §9.2; Journeys-Design §8.1).
 * Thin Prisma wrapper with zero business logic.
 */
export class JourneyRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a journey by ID. */
  findById(id: string): Promise<Journey | null> {
    return this.db.journey.findUnique({
      where: { id },
    });
  }

  /**
   * Finds all journeys for a given user, ordered by travel date ascending.
   */
  findByUserId(userId: string): Promise<Journey[]> {
    return this.db.journey.findMany({
      where: { userId },
      orderBy: [{ travelDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Creates a new journey record.
   */
  create(data: CreateJourneyData, tx?: Prisma.TransactionClient): Promise<Journey> {
    const client = tx ?? this.db;
    return client.journey.create({
      data: {
        userId: data.userId,
        userName: data.userName ?? null,
        trainNumber: data.trainNumber,
        trainName: data.trainName ?? null,
        travelDate: data.travelDate,
        coach: data.coach ?? null,
        boardingStation: data.boardingStation ?? null,
        destinationStation: data.destinationStation ?? null,
        college: data.college ?? null,
        gender: data.gender ?? null,
      },
    });
  }

  /**
   * Deletes a journey only if it belongs to the specified user.
   * Returns true if a row was deleted, false otherwise.
   */
  async deleteByIdAndUser(id: string, userId: string): Promise<boolean> {
    const result = await this.db.journey.deleteMany({
      where: {
        id,
        userId,
      },
    });
    return result.count > 0;
  }

  /**
   * Discovers matching journeys on the same train number and travel date,
   * excluding the requesting user and any symmetrically blocked users.
   */
  findCompanions(
    userId: string,
    trainNumber: string,
    travelDate: Date,
    blockedUserIds: string[] = [],
  ): Promise<Journey[]> {
    const excludedUserIds = [userId, ...blockedUserIds];

    return this.db.journey.findMany({
      where: {
        trainNumber,
        travelDate,
        userId: {
          notIn: excludedUserIds,
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  }

  /**
   * Checks if user has a journey matching the specified train number and travel date.
   */
  async hasJourneyOnTrainAndDate(
    userId: string,
    trainNumber: string,
    travelDate: Date,
  ): Promise<boolean> {
    const count = await this.db.journey.count({
      where: {
        userId,
        trainNumber,
        travelDate,
      },
    });
    return count > 0;
  }

  /**
   * Checks if two users share any journey (same train number and travel date).
   */
  async hasSharedJourney(userA: string, userB: string): Promise<boolean> {
    if (userA === userB) return false;

    const result = await this.db.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM journeys j1
        JOIN journeys j2 ON j1.train_number = j2.train_number
                         AND j1.travel_date = j2.travel_date
        WHERE j1.user_id = ${userA}::uuid
          AND j2.user_id = ${userB}::uuid
      ) as "exists"
    `;

    return result[0]?.exists ?? false;
  }

  /**
   * Checks if two users share a specific journey on trainNumber and travelDate.
   */
  async usersShareSpecificJourney(
    userA: string,
    userB: string,
    trainNumber: string,
    travelDate: Date,
  ): Promise<boolean> {
    if (userA === userB) return false;

    const [hasA, hasB] = await Promise.all([
      this.hasJourneyOnTrainAndDate(userA, trainNumber, travelDate),
      this.hasJourneyOnTrainAndDate(userB, trainNumber, travelDate),
    ]);

    return hasA && hasB;
  }
}
