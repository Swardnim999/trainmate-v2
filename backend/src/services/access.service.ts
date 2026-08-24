import type { PrismaClient } from '@prisma/client';
import { BlockedUserRepository } from '../repositories/blocked-users.repo.js';
import { prisma } from '../lib/prisma.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface ContextualRelationshipChecker {
  hasSharedJourney?(userA: string, userB: string): Promise<boolean>;
  hasAcceptedRequest?(userA: string, userB: string): Promise<boolean>;
  hasSharedConversation?(userA: string, userB: string): Promise<boolean>;
}

export interface AccessServiceDeps {
  blockedUsers?: BlockedUserRepository;
  db?: PrismaClient;
  contextual?: ContextualRelationshipChecker;
}

/**
 * AccessService — The system-wide authorization & visibility query engine
 * (Moderation-Design §6.1, Profiles-Design §5).
 *
 * Exposes the canonical symmetric `isBlocked(userA, userB)` and contextual
 * `canViewProfile(requesterId, targetProfileId)` checks.
 */
export class AccessService {
  private readonly blockedUsers: BlockedUserRepository;
  private readonly db: PrismaClient;
  private readonly contextual?: ContextualRelationshipChecker;

  constructor(deps: Partial<AccessServiceDeps> = {}) {
    this.blockedUsers = deps.blockedUsers ?? new BlockedUserRepository(deps.db ?? prisma);
    this.db = deps.db ?? prisma;
    this.contextual = deps.contextual;
  }

  /**
   * Universal symmetric block check (Auth-Design / Moderation-Design §3.1).
   *
   * Invariants:
   * 1. Symmetry: isBlocked(A, B) === true iff A blocked B OR B blocked A.
   * 2. Reflexivity: isBlocked(A, A) === false.
   * 3. Null safety: returns false for invalid, missing, empty, or non-UUID inputs.
   */
  async isBlocked(userA: string, userB: string): Promise<boolean> {
    if (!isValidUuid(userA) || !isValidUuid(userB)) {
      return false;
    }

    if (userA === userB) {
      return false;
    }

    return this.blockedUsers.isBlocked(userA, userB);
  }

  /**
   * Returns a Set of all user IDs that have a symmetric blocking relationship
   * with the given user (either blocked by the user OR blocking the user).
   * Used for efficient list filtering in companion/journey/request queries.
   */
  async getSymmetricBlockedUserIds(userId: string): Promise<Set<string>> {
    if (!isValidUuid(userId)) {
      return new Set();
    }

    const ids = await this.blockedUsers.findSymmetricBlockedIds(userId);
    return new Set(ids);
  }

  /**
   * Contextual Profile Visibility Check (Spec §6.1, Profiles-Design §5).
   *
   * A requester R may view target T's profile iff:
   * 1. R === T (own profile)
   * 2. OR (
   *      !isBlocked(R, T)
   *      AND (
   *        shared journey on same train/date
   *        OR accepted companion request
   *        OR shared active conversation
   *      )
   *    )
   */
  async canViewProfile(requesterId: string, targetProfileId: string): Promise<boolean> {
    if (!isValidUuid(requesterId) || !isValidUuid(targetProfileId)) {
      return false;
    }

    // 1. Own profile is always visible
    if (requesterId === targetProfileId) {
      return true;
    }

    // 2. Symmetric block check (if either blocked the other, visibility is completely revoked)
    const blocked = await this.isBlocked(requesterId, targetProfileId);
    if (blocked) {
      return false;
    }

    // 3. Check contextual relationship arms
    const sharedJourney = await this.hasSharedJourney(requesterId, targetProfileId);
    if (sharedJourney) {
      return true;
    }

    const acceptedRequest = await this.hasAcceptedRequest(requesterId, targetProfileId);
    if (acceptedRequest) {
      return true;
    }

    const sharedConversation = await this.hasSharedConversation(requesterId, targetProfileId);
    if (sharedConversation) {
      return true;
    }

    return false;
  }

  /** Checks if two users share a journey on the same train number and date. */
  async hasSharedJourney(userA: string, userB: string): Promise<boolean> {
    if (this.contextual?.hasSharedJourney) {
      return this.contextual.hasSharedJourney(userA, userB);
    }
    try {
      const result = await this.db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM "journeys" j1
        INNER JOIN "journeys" j2
          ON j1.train_number = j2.train_number
         AND j1.travel_date = j2.travel_date
        WHERE j1.user_id = ${userA}::uuid
          AND j2.user_id = ${userB}::uuid
      `;
      return (result[0]?.count ?? 0n) > 0n;
    } catch {
      return false;
    }
  }

  /** Checks if an accepted companion request exists between userA and userB. */
  async hasAcceptedRequest(userA: string, userB: string): Promise<boolean> {
    if (!isValidUuid(userA) || !isValidUuid(userB) || userA === userB) {
      return false;
    }

    if (this.contextual?.hasAcceptedRequest) {
      return this.contextual.hasAcceptedRequest(userA, userB);
    }
    try {
      const count = await this.db.request.count({
        where: {
          status: 'accepted',
          OR: [
            { fromUserId: userA, toUserId: userB },
            { fromUserId: userB, toUserId: userA },
          ],
        },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  /** Checks if userA and userB are participants in a shared active conversation. */
  async hasSharedConversation(userA: string, userB: string): Promise<boolean> {
    if (this.contextual?.hasSharedConversation) {
      return this.contextual.hasSharedConversation(userA, userB);
    }
    try {
      const result = await this.db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM "conversations"
        WHERE ${userA}::uuid = ANY(participants)
          AND ${userB}::uuid = ANY(participants)
      `;
      return (result[0]?.count ?? 0n) > 0n;
    } catch {
      return false;
    }
  }

  /**
   * Checks if user has a journey with matching train number and travel date
   * (Spec §6.2 `can_view_journey`).
   */
  async canViewJourney(
    userId: string,
    trainNumber: string,
    travelDate: Date | string,
  ): Promise<boolean> {
    if (!isValidUuid(userId) || !trainNumber || !travelDate) {
      return false;
    }

    const dateObj = typeof travelDate === 'string' ? new Date(travelDate) : travelDate;
    if (isNaN(dateObj.getTime())) {
      return false;
    }

    try {
      const count = await this.db.journey.count({
        where: {
          userId,
          trainNumber,
          travelDate: dateObj,
        },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Checks if two users share a specific journey on trainNumber and travelDate
   * (Spec §6.3 `users_share_journey`).
   */
  async usersShareJourney(
    userA: string,
    userB: string,
    trainNumber: string,
    travelDate: Date | string,
  ): Promise<boolean> {
    if (!isValidUuid(userA) || !isValidUuid(userB) || userA === userB) {
      return false;
    }

    const [hasA, hasB] = await Promise.all([
      this.canViewJourney(userA, trainNumber, travelDate),
      this.canViewJourney(userB, trainNumber, travelDate),
    ]);

    return hasA && hasB;
  }
}
