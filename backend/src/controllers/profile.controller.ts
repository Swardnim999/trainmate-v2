import type { Request, Response } from 'express';
import { ProfileService, type UpdateProfileInput } from '../services/profile.service.js';
import { validated } from '../middleware/validate.js';

export interface ProfileControllerDeps {
  profileService?: ProfileService;
}

/**
 * Profile HTTP controller (Milestone 7).
 *
 * Enforces Zod input validation, extracts caller identity from JWT claims (req.user),
 * and delegates business logic and visibility authorization to ProfileService.
 */
export class ProfileController {
  private readonly profileService: ProfileService;

  constructor(deps: ProfileControllerDeps = {}) {
    this.profileService = deps.profileService ?? new ProfileService();
  }

  getOwnProfile = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const result = await this.profileService.getOwnProfile(userId);
    res.status(200).json(result);
  };

  updateOwnProfile = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const input = validated<UpdateProfileInput>(req, 'body');
    const result = await this.profileService.updateOwnProfile(userId, input);
    res.status(200).json(result);
  };

  getPublicProfile = async (req: Request, res: Response): Promise<void> => {
    const requesterId = req.user!.id;
    const { userId } = validated<{ userId: string }>(req, 'params');
    const result = await this.profileService.getPublicProfile(requesterId, userId);
    res.status(200).json(result);
  };

  getProfileName = async (req: Request, res: Response): Promise<void> => {
    const requesterId = req.user!.id;
    const { userId } = validated<{ userId: string }>(req, 'params');
    const result = await this.profileService.getProfileName(requesterId, userId);
    res.status(200).json(result);
  };
}
