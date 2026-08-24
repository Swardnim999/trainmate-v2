import type { Request, Response } from 'express';
import { TrainService } from '../services/train.service.js';
import { JourneySerializer } from '../serializers/journey.serializer.js';
import { validated } from '../middleware/validate.js';

export interface TrainControllerDeps {
  trainService?: TrainService;
}

/**
 * Train Directory HTTP Controller (Milestone 8).
 * Handles autocomplete search and unverified train logging.
 */
export class TrainController {
  private readonly trainService: TrainService;

  constructor(deps: TrainControllerDeps = {}) {
    this.trainService = deps.trainService ?? new TrainService();
  }

  searchTrains = async (req: Request, res: Response): Promise<void> => {
    const { q, limit } = validated<{ q?: string; limit?: number }>(req, 'query');
    const trains = await this.trainService.search(q ?? '', limit ?? 15);
    res.status(200).json(JourneySerializer.toTrainResponseList(trains));
  };

  logUnverifiedTrain = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { trainNumber, trainName } = validated<{
      trainNumber: string;
      trainName?: string | null;
    }>(req, 'body');
    const entry = await this.trainService.logUnverifiedTrain({
      trainNumber,
      trainName,
      submittedBy: userId,
    });
    res.status(201).json(JourneySerializer.toUnverifiedTrainResponse(entry));
  };
}
