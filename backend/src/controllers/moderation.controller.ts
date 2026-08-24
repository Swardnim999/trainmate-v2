import type { Request, Response } from 'express';
import { ModerationService } from '../services/moderation.service.js';
import { validated } from '../middleware/validate.js';

export interface ModerationControllerDeps {
  moderation?: ModerationService;
}

/**
 * Moderation HTTP controller (Milestone 6).
 *
 * Deliberately thin: inputs are validated by Zod boundary middleware,
 * user identity is extracted from verified JWT claims (req.user),
 * and business rules are delegated to ModerationService.
 */
export class ModerationController {
  private readonly moderation: ModerationService;

  constructor(deps: ModerationControllerDeps = {}) {
    this.moderation = deps.moderation ?? new ModerationService();
  }

  getBlockedUsers = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const result = await this.moderation.getBlockedUsers(userId);
    res.status(200).json(result);
  };

  blockUser = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { blocked_id } = validated<{ blocked_id: string }>(req, 'body');
    const result = await this.moderation.blockUser(userId, blocked_id);
    res.status(200).json(result);
  };

  unblockUser = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { blockedId } = validated<{ blockedId: string }>(req, 'params');
    await this.moderation.unblockUser(userId, blockedId);
    res.status(204).end();
  };

  reportUser = async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { reported_id, reason } = validated<{
      reported_id: string;
      reason?: string | null;
    }>(req, 'body');
    const result = await this.moderation.reportUser(userId, reported_id, reason);
    res.status(201).json(result);
  };
}
