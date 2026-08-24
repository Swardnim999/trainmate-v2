import type { Train, UnverifiedTrain } from '@prisma/client';
import { TrainRepository } from '../repositories/trains.repo.js';
import { UnverifiedTrainRepository } from '../repositories/unverified-trains.repo.js';

export interface LogUnverifiedTrainInput {
  trainNumber: string;
  trainName?: string | null;
  submittedBy?: string | null;
}

export interface TrainServiceDeps {
  trainRepo?: TrainRepository;
  unverifiedRepo?: UnverifiedTrainRepository;
}

/**
 * TrainService — Business logic for Indian Railways train autocomplete and
 * unverified train logging (Spec §3.2, §9.3, §10.9; Roadmap Phase 7).
 */
export class TrainService {
  private readonly trainRepo: TrainRepository;
  private readonly unverifiedRepo: UnverifiedTrainRepository;

  constructor(deps: Partial<TrainServiceDeps> = {}) {
    this.trainRepo = deps.trainRepo ?? new TrainRepository();
    this.unverifiedRepo = deps.unverifiedRepo ?? new UnverifiedTrainRepository();
  }

  /**
   * Autocomplete search for trains matching query.
   * Matches number or name (case-insensitive) and returns up to `limit` active trains.
   */
  async search(query: string, limit: number = 15): Promise<Train[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }
    return this.trainRepo.search(query, limit);
  }

  /**
   * Logs an unverified train number submitted by a user.
   */
  async logUnverifiedTrain(input: LogUnverifiedTrainInput): Promise<UnverifiedTrain> {
    const rawNumber = input.trainNumber.trim();
    return this.unverifiedRepo.create({
      trainNumber: rawNumber,
      trainName: input.trainName?.trim() || null,
      submittedBy: input.submittedBy ?? null,
      enteredValue: rawNumber,
      normalizedValue: rawNumber.toLowerCase().trim(),
    });
  }
}
