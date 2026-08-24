import type { Journey, PrismaClient } from '@prisma/client';
import { JourneyRepository } from '../repositories/journeys.repo.js';
import { TrainRepository } from '../repositories/trains.repo.js';
import { UnverifiedTrainRepository } from '../repositories/unverified-trains.repo.js';
import { ProfileRepository } from '../repositories/profiles.repo.js';
import { AccessService } from './access.service.js';
import { AppError } from '../utils/errors.js';
import { prisma } from '../lib/prisma.js';

export interface CreateJourneyInput {
  trainNumber: string;
  trainName?: string | null;
  travelDate: string | Date;
  coach?: string | null;
  boardingStation?: string | null;
  destinationStation?: string | null;
  college?: string | null;
  gender?: string | null;
  userName?: string | null;
  isTrainVerified?: boolean;
}

export interface JourneyServiceDeps {
  journeys?: JourneyRepository;
  trains?: TrainRepository;
  unverifiedTrains?: UnverifiedTrainRepository;
  profiles?: ProfileRepository;
  access?: AccessService;
  db?: PrismaClient;
}

/**
 * JourneyService — Business logic for travel plan management, exact-match companion
 * discovery, and unverified train logging (Spec §3.2, §6.2, §9.2; Journeys-Design §8).
 */
export class JourneyService {
  private readonly journeys: JourneyRepository;
  private readonly trains: TrainRepository;
  private readonly unverifiedTrains: UnverifiedTrainRepository;
  private readonly profiles: ProfileRepository;
  private readonly access: AccessService;
  private readonly db: PrismaClient;

  constructor(deps: Partial<JourneyServiceDeps> = {}) {
    this.journeys = deps.journeys ?? new JourneyRepository(deps.db ?? prisma);
    this.trains = deps.trains ?? new TrainRepository(deps.db ?? prisma);
    this.unverifiedTrains =
      deps.unverifiedTrains ?? new UnverifiedTrainRepository(deps.db ?? prisma);
    this.profiles = deps.profiles ?? new ProfileRepository(deps.db ?? prisma);
    this.access = deps.access ?? new AccessService({ db: deps.db ?? prisma });
    this.db = deps.db ?? prisma;
  }

  /**
   * Retrieves all journeys for the authenticated user, ordered by travel date ASC.
   */
  async listUserJourneys(userId: string): Promise<Journey[]> {
    return this.journeys.findByUserId(userId);
  }

  /**
   * Creates a new journey for the user.
   *
   * Business rules:
   * 1. Resolves display name (from input or fallback to user profile name).
   * 2. Denormalizes train_name from verified trains table if found.
   * 3. Atomically logs to unverified_trains in the SAME transaction if train is unverified.
   */
  async createJourney(userId: string, input: CreateJourneyInput): Promise<Journey> {
    const rawTrainNumber = input.trainNumber.trim();

    // 1. Resolve travelDate
    const travelDateObj =
      typeof input.travelDate === 'string'
        ? new Date(`${input.travelDate.split('T')[0]}T00:00:00.000Z`)
        : input.travelDate;

    if (isNaN(travelDateObj.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid travel date format');
    }

    // 2. Resolve user display name
    let resolvedUserName = input.userName?.trim() || null;
    if (!resolvedUserName) {
      const profile = await this.profiles.findById(userId);
      resolvedUserName = profile?.name ?? null;
    }

    // 3. Check train verified status and denormalize train_name
    const existingTrain = await this.trains.findByNumber(rawTrainNumber);
    const resolvedTrainName = existingTrain?.trainName ?? (input.trainName?.trim() || null);
    const isVerified =
      input.isTrainVerified !== undefined ? input.isTrainVerified : !!existingTrain;

    // 4. If unverified, insert unverified train log and journey in a single transaction
    if (!isVerified) {
      return this.db.$transaction(async (tx) => {
        await this.unverifiedTrains.create(
          {
            trainNumber: rawTrainNumber,
            trainName: resolvedTrainName,
            submittedBy: userId,
            enteredValue: rawTrainNumber,
            normalizedValue: rawTrainNumber.toLowerCase().trim(),
          },
          tx,
        );

        return this.journeys.create(
          {
            userId,
            userName: resolvedUserName,
            trainNumber: rawTrainNumber,
            trainName: resolvedTrainName,
            travelDate: travelDateObj,
            coach: input.coach?.trim() || null,
            boardingStation: input.boardingStation?.trim() || null,
            destinationStation: input.destinationStation?.trim() || null,
            college: input.college?.trim() || null,
            gender: input.gender?.trim() || null,
          },
          tx,
        );
      });
    }

    // 5. Verified train: direct insert
    return this.journeys.create({
      userId,
      userName: resolvedUserName,
      trainNumber: rawTrainNumber,
      trainName: resolvedTrainName,
      travelDate: travelDateObj,
      coach: input.coach?.trim() || null,
      boardingStation: input.boardingStation?.trim() || null,
      destinationStation: input.destinationStation?.trim() || null,
      college: input.college?.trim() || null,
      gender: input.gender?.trim() || null,
    });
  }

  /**
   * Deletes a journey owned by the user.
   * Throws 404 NOT_FOUND if journey does not exist or belongs to another user
   * (masks existence of foreign journeys).
   */
  async deleteJourney(journeyId: string, userId: string): Promise<void> {
    const deleted = await this.journeys.deleteByIdAndUser(journeyId, userId);
    if (!deleted) {
      throw new AppError(404, 'JOURNEY_NOT_FOUND', 'Journey not found');
    }
  }

  /**
   * Companion Discovery — finds journeys matching exact train_number and travel_date.
   *
   * Invariants:
   * 1. Exact match: trainNumber === trainNumber AND travelDate === travelDate.
   * 2. Self-excluded: userId !== callerId.
   * 3. Symmetric blocking: excludes all users with active block in either direction.
   */
  async findCompanions(
    userId: string,
    trainNumber: string,
    travelDate: string | Date,
  ): Promise<Journey[]> {
    const rawTrainNumber = trainNumber.trim();
    const travelDateObj =
      typeof travelDate === 'string'
        ? new Date(`${travelDate.split('T')[0]}T00:00:00.000Z`)
        : travelDate;

    if (isNaN(travelDateObj.getTime())) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid travel date format');
    }

    // Fetch symmetrically blocked user IDs
    const blockedUserIds = await this.access.getSymmetricBlockedUserIds(userId);

    return this.journeys.findCompanions(
      userId,
      rawTrainNumber,
      travelDateObj,
      Array.from(blockedUserIds),
    );
  }
}
