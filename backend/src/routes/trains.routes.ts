import { Router } from 'express';
import { TrainController } from '../controllers/train.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { TrainService } from '../services/train.service.js';
import {
  trainSearchQuerySchema,
  createUnverifiedTrainSchema,
} from '../validation/train.schemas.js';

export interface TrainRouterDeps {
  trainService?: TrainService;
}

/**
 * Train directory and unverified train logging routes (Spec §10.9; Journeys-Design §7).
 * Mounts:
 * - GET /trains
 * - POST /trains/unverified
 */
export function createTrainRouter(deps: TrainRouterDeps = {}): Router {
  const router = Router();
  const service = deps.trainService ?? new TrainService();
  const controller = new TrainController({ trainService: service });

  router.get(
    '/trains',
    authenticate,
    validateQuery(trainSearchQuerySchema),
    controller.searchTrains,
  );

  router.post(
    '/trains/unverified',
    authenticate,
    validateBody(createUnverifiedTrainSchema),
    controller.logUnverifiedTrain,
  );

  return router;
}
