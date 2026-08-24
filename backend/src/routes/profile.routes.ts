import { Router } from 'express';
import { ProfileController } from '../controllers/profile.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { ProfileService } from '../services/profile.service.js';
import { updateProfileSchema, profileParamsSchema } from '../validation/profile.schemas.js';

export interface ProfileRouterDeps {
  profileService?: ProfileService;
}

/**
 * Profile and identity routes (Spec §10.2, Profiles-Design §8).
 * Mounts:
 * - GET /profiles/me
 * - PATCH /profiles/me
 * - GET /profiles/:userId/name
 * - GET /profiles/:userId
 */
export function createProfileRouter(deps: ProfileRouterDeps = {}): Router {
  const router = Router();
  const service = deps.profileService ?? new ProfileService();
  const controller = new ProfileController({ profileService: service });

  // Own profile endpoints
  router.get('/profiles/me', authenticate, controller.getOwnProfile);
  router.patch(
    '/profiles/me',
    authenticate,
    validateBody(updateProfileSchema),
    controller.updateOwnProfile,
  );

  // Companion / public profile endpoints
  router.get(
    '/profiles/:userId/name',
    authenticate,
    validateParams(profileParamsSchema),
    controller.getProfileName,
  );

  router.get(
    '/profiles/:userId',
    authenticate,
    validateParams(profileParamsSchema),
    controller.getPublicProfile,
  );

  return router;
}
