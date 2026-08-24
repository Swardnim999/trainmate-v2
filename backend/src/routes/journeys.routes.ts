import { Router } from 'express';
import { JourneyController } from '../controllers/journey.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { JourneyService } from '../services/journey.service.js';
import {
  createJourneySchema,
  journeyIdParamSchema,
  companionParamsSchema,
} from '../validation/journey.schemas.js';

export interface JourneyRouterDeps {
  journeyService?: JourneyService;
}

/**
 * Journey and companion matching routes (Spec §10.3; Journeys-Design §7).
 * Mounts:
 * - GET /journeys/me
 * - POST /journeys
 * - DELETE /journeys/:id
 * - GET /journeys/:trainNumber/:travelDate/companions
 */
export function createJourneyRouter(deps: JourneyRouterDeps = {}): Router {
  const router = Router();
  const service = deps.journeyService ?? new JourneyService();
  const controller = new JourneyController({ journeyService: service });

  // Own journey endpoints
  router.get('/journeys/me', authenticate, controller.getMyJourneys);
  router.post(
    '/journeys',
    authenticate,
    validateBody(createJourneySchema),
    controller.createJourney,
  );
  router.delete(
    '/journeys/:id',
    authenticate,
    validateParams(journeyIdParamSchema),
    controller.deleteJourney,
  );

  // Companion discovery endpoint
  router.get(
    '/journeys/:trainNumber/:travelDate/companions',
    authenticate,
    validateParams(companionParamsSchema),
    controller.getCompanions,
  );

  return router;
}
