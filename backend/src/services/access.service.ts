import { BlockedUserRepository } from '../repositories/blocked-users.repo.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export interface AccessServiceDeps {
  blockedUsers?: BlockedUserRepository;
}

/**
 * AccessService — The system-wide authorization & visibility query engine
 * (Moderation-Design §6.1, Roadmap Phase 5).
 *
 * Exposes the canonical symmetric `isBlocked(userA, userB)` check that all
 * downstream services (profiles, journeys, matching, requests, conversations,
 * messages, realtime) rely on.
 */
export class AccessService {
  private readonly blockedUsers: BlockedUserRepository;

  constructor(deps: Partial<AccessServiceDeps> = {}) {
    this.blockedUsers = deps.blockedUsers ?? new BlockedUserRepository();
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
}
