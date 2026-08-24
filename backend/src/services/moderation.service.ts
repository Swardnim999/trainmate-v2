import type { BlockedUser, UserReport } from '@prisma/client';
import { BlockedUserRepository } from '../repositories/blocked-users.repo.js';
import { UserReportRepository } from '../repositories/user-reports.repo.js';
import { UserRepository } from '../repositories/users.repo.js';
import { AccessService } from './access.service.js';
import { AppError } from '../utils/errors.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';

export interface ModerationServiceDeps {
  blockedUsers?: BlockedUserRepository;
  userReports?: UserReportRepository;
  users?: UserRepository;
  access?: AccessService;
}

/**
 * ModerationService — Core moderation workflows (Moderation-Design §6.2).
 *
 * Implements business rules for:
 * 1. Blocking: own-row forcing, target verification, self-block rejection, duplicate-block idempotency.
 * 2. Unblocking: directional deletion, missing-row idempotency.
 * 3. Listing: returns user IDs blocked by caller.
 * 4. Reporting: own-row forcing, target verification, self-report rejection, reason normalization.
 */
export class ModerationService {
  private readonly blockedUsers: BlockedUserRepository;
  private readonly userReports: UserReportRepository;
  private readonly users: UserRepository;
  readonly access: AccessService;

  constructor(deps: Partial<ModerationServiceDeps> = {}) {
    this.blockedUsers = deps.blockedUsers ?? new BlockedUserRepository();
    this.userReports = deps.userReports ?? new UserReportRepository();
    this.users = deps.users ?? new UserRepository();
    this.access = deps.access ?? new AccessService({ blockedUsers: this.blockedUsers });
  }

  /**
   * Blocks a target user on behalf of blockerId.
   *
   * Invariants:
   * - Self-block is rejected as 400 VALIDATION_ERROR.
   * - Target user must exist; missing target is 404 USER_NOT_FOUND.
   * - Duplicate block is idempotent: returns the existing or created block record.
   */
  async blockUser(blockerId: string, blockedId: string): Promise<BlockedUser> {
    if (blockerId === blockedId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot block yourself');
    }

    const targetUser = await this.users.findById(blockedId);
    if (!targetUser) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const existing = await this.blockedUsers.findByPair(blockerId, blockedId);
    if (existing) {
      return existing;
    }

    try {
      return await this.blockedUsers.create({ blockerId, blockedId });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raceExisting = await this.blockedUsers.findByPair(blockerId, blockedId);
        if (raceExisting) return raceExisting;
      }
      throw error;
    }
  }

  /**
   * Unblocks a target user.
   * Deletes only the directional row owned by blockerId.
   * Idempotent (succeeds silently even if block did not exist).
   */
  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.blockedUsers.deleteByPair(blockerId, blockedId);
  }

  /**
   * Returns list of user IDs blocked by the caller: [{ blocked_id: string }]
   * Matching the exact shape expected by frontend useBlockedUsers hook.
   */
  async getBlockedUsers(blockerId: string): Promise<{ blocked_id: string }[]> {
    const ids = await this.blockedUsers.findBlockedIdsByBlocker(blockerId);
    return ids.map((blocked_id) => ({ blocked_id }));
  }

  /**
   * Submits a report against a target user.
   *
   * Invariants:
   * - Self-report is rejected as 400 VALIDATION_ERROR.
   * - Target user must exist; missing target is 404 USER_NOT_FOUND.
   * - Reason is trimmed; empty reason normalized to null.
   * - Duplicate reports are permitted (fresh record created).
   */
  async reportUser(
    reporterId: string,
    reportedId: string,
    reason?: string | null,
  ): Promise<UserReport> {
    if (reporterId === reportedId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot report yourself');
    }

    const targetUser = await this.users.findById(reportedId);
    if (!targetUser) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const normalizedReason =
      typeof reason === 'string' && reason.trim().length > 0 ? reason.trim() : null;

    return this.userReports.create({
      reporterId,
      reportedId,
      reason: normalizedReason,
    });
  }
}
