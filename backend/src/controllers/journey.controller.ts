import type { Request, Response } from 'express';
import { JourneyService, type CreateJourneyInput } from '../services/journey.service.js';
import { JourneySerializer } from '../serializers/journey.serializer.js';
import { validated } from '../middleware/validate.js';

export interface JourneyControllerDeps {
  journeyService?: JourneyService;
}

/**
 * Journey HTTP Controller (Milestone 8).
 * Thin controller extracting parameters and delegating to JourneyService.
 */
export class JourneyController {
  private readonly journeyService: JourneyService;

  constructor(deps: JourneyControllerDeps = {}) {
    this.journeyService = deps.journeyService ?? new JourneyService();
  }

  getMyJourneys = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const journeys = await this.journeyService.listUserJourneys(userId);
    res.status(200).json(JourneySerializer.toResponseList(journeys));
  };

  createJourney = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const input = validated<CreateJourneyInput>(req, 'body');
    const journey = await this.journeyService.createJourney(userId, input);
    res.status(201).json(JourneySerializer.toResponse(journey));
  };

  deleteJourney = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id } = validated<{ id: string }>(req, 'params');
    await this.journeyService.deleteJourney(id, userId);
    res.status(204).send();
  };

  getCompanions = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { trainNumber, travelDate } = validated<{ trainNumber: string; travelDate: string }>(
      req,
      'params',
    );
    const companions = await this.journeyService.findCompanions(userId, trainNumber, travelDate);
    res.status(200).json(JourneySerializer.toResponseList(companions));
  };
}
