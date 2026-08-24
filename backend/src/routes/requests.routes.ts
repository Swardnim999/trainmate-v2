import { Router } from 'express';
import { RequestController } from '../controllers/request.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import { RequestService } from '../services/request.service.js';
import {
  createRequestSchema,
  updateRequestStatusSchema,
  requestIdParamSchema,
  listRequestsQuerySchema,
  cleanupExpiredRequestsSchema,
} from '../validation/request.schemas.js';

export interface RequestRouterDeps {
  requestService?: RequestService;
}

/**
 * Companion requests lifecycle routes (Spec §10.4; Requests-Design §10).
 * Mounts:
 * - GET /requests/me
 * - GET /requests/me/accepted
 * - GET /requests/incoming/pending-count
 * - POST /requests
 * - POST /requests/cleanup-expired
 * - PATCH /requests/:id
 * - DELETE /requests/:id
 */
export function createRequestRouter(deps: RequestRouterDeps = {}): Router {
  const router = Router();
  const service = deps.requestService ?? new RequestService();
  const controller = new RequestController({ requestService: service });

  // List and count endpoints
  router.get(
    '/requests/me',
    authenticate,
    validateQuery(listRequestsQuerySchema),
    controller.getMyRequests,
  );
  router.get('/requests/me/accepted', authenticate, controller.getMyAcceptedRequests);
  router.get('/requests/incoming/pending-count', authenticate, controller.getIncomingPendingCount);

  // Send request
  router.post('/requests', authenticate, validateBody(createRequestSchema), controller.sendRequest);

  // Prune expired
  router.post(
    '/requests/cleanup-expired',
    authenticate,
    validateBody(cleanupExpiredRequestsSchema),
    controller.cleanupExpiredRequests,
  );

  // Status transition & cancellation
  router.patch(
    '/requests/:id',
    authenticate,
    validateParams(requestIdParamSchema),
    validateBody(updateRequestStatusSchema),
    controller.updateRequestStatus,
  );
  router.delete(
    '/requests/:id',
    authenticate,
    validateParams(requestIdParamSchema),
    controller.cancelRequest,
  );

  return router;
}
