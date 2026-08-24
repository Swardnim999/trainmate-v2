import { describe, expect, it, vi } from 'vitest';
import { AccessService } from '../../src/services/access.service.js';
import type { BlockedUserRepository } from '../../src/repositories/blocked-users.repo.js';

const USER_A = '00000000-0000-4000-8000-000000000001';
const USER_B = '00000000-0000-4000-8000-000000000002';
const USER_C = '00000000-0000-4000-8000-000000000003';

function createMockBlockedUserRepo() {
  return {
    findByPair: vi.fn(),
    isBlocked: vi.fn(),
    findBlockedIdsByBlocker: vi.fn(),
    findSymmetricBlockedIds: vi.fn(),
    create: vi.fn(),
    deleteByPair: vi.fn(),
  };
}

describe('AccessService.isBlocked — Truth Table & Invariants', () => {
  it('returns false when userA === userB (reflexivity: cannot be blocked by oneself)', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });

    const result = await access.isBlocked(USER_A, USER_A);

    expect(result).toBe(false);
    expect(repo.isBlocked).not.toHaveBeenCalled();
  });

  it('returns false for invalid, missing, or empty user IDs without querying repo', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });

    expect(await access.isBlocked('', USER_B)).toBe(false);
    expect(await access.isBlocked(USER_A, '')).toBe(false);
    expect(await access.isBlocked('not-a-uuid', USER_B)).toBe(false);
    expect(await access.isBlocked(USER_A, 'not-a-uuid')).toBe(false);
    expect(await access.isBlocked(undefined as unknown as string, USER_B)).toBe(false);
    expect(await access.isBlocked(USER_A, null as unknown as string)).toBe(false);

    expect(repo.isBlocked).not.toHaveBeenCalled();
  });

  it('is strictly symmetric: returns true whether A blocked B or B blocked A', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });
    repo.isBlocked.mockResolvedValue(true);

    // Direction A -> B
    const resultAB = await access.isBlocked(USER_A, USER_B);
    expect(resultAB).toBe(true);
    expect(repo.isBlocked).toHaveBeenCalledWith(USER_A, USER_B);

    // Direction B -> A
    const resultBA = await access.isBlocked(USER_B, USER_A);
    expect(resultBA).toBe(true);
    expect(repo.isBlocked).toHaveBeenCalledWith(USER_B, USER_A);
  });

  it('returns false when no block exists between the pair', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });
    repo.isBlocked.mockResolvedValue(false);

    const result = await access.isBlocked(USER_A, USER_B);

    expect(result).toBe(false);
    expect(repo.isBlocked).toHaveBeenCalledWith(USER_A, USER_B);
  });
});

describe('AccessService.getSymmetricBlockedUserIds', () => {
  it('returns empty Set for invalid user ID', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });

    const result = await access.getSymmetricBlockedUserIds('invalid-uuid');

    expect(result).toEqual(new Set());
    expect(repo.findSymmetricBlockedIds).not.toHaveBeenCalled();
  });

  it('returns Set of user IDs returned by repo', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });
    repo.findSymmetricBlockedIds.mockResolvedValue([USER_B, USER_C]);

    const result = await access.getSymmetricBlockedUserIds(USER_A);

    expect(result).toEqual(new Set([USER_B, USER_C]));
    expect(repo.findSymmetricBlockedIds).toHaveBeenCalledWith(USER_A);
  });
});

describe('AccessService.canViewProfile — Contextual Visibility Truth Table (Spec §6.1)', () => {
  it('returns false for invalid UUIDs', async () => {
    const access = new AccessService();
    expect(await access.canViewProfile('invalid', USER_B)).toBe(false);
    expect(await access.canViewProfile(USER_A, 'invalid')).toBe(false);
  });

  it('returns true when requester === target (self-ownership)', async () => {
    const repo = createMockBlockedUserRepo();
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
    });

    const result = await access.canViewProfile(USER_A, USER_A);

    expect(result).toBe(true);
    expect(repo.isBlocked).not.toHaveBeenCalled();
  });

  it('returns false when blocked, even if contextual relationships exist', async () => {
    const repo = createMockBlockedUserRepo();
    repo.isBlocked.mockResolvedValue(true);
    const mockContextual = {
      hasSharedJourney: vi.fn().mockResolvedValue(true),
      hasAcceptedRequest: vi.fn().mockResolvedValue(true),
      hasSharedConversation: vi.fn().mockResolvedValue(true),
    };
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
      contextual: mockContextual,
    });

    const result = await access.canViewProfile(USER_A, USER_B);

    expect(result).toBe(false);
    expect(repo.isBlocked).toHaveBeenCalledWith(USER_A, USER_B);
    expect(mockContextual.hasSharedJourney).not.toHaveBeenCalled();
  });

  it('returns true when shared journey exists (and unblocked)', async () => {
    const repo = createMockBlockedUserRepo();
    repo.isBlocked.mockResolvedValue(false);
    const mockContextual = {
      hasSharedJourney: vi.fn().mockResolvedValue(true),
      hasAcceptedRequest: vi.fn().mockResolvedValue(false),
      hasSharedConversation: vi.fn().mockResolvedValue(false),
    };
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
      contextual: mockContextual,
    });

    const result = await access.canViewProfile(USER_A, USER_B);

    expect(result).toBe(true);
    expect(mockContextual.hasSharedJourney).toHaveBeenCalledWith(USER_A, USER_B);
  });

  it('returns true when accepted request exists (and unblocked)', async () => {
    const repo = createMockBlockedUserRepo();
    repo.isBlocked.mockResolvedValue(false);
    const mockContextual = {
      hasSharedJourney: vi.fn().mockResolvedValue(false),
      hasAcceptedRequest: vi.fn().mockResolvedValue(true),
      hasSharedConversation: vi.fn().mockResolvedValue(false),
    };
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
      contextual: mockContextual,
    });

    const result = await access.canViewProfile(USER_A, USER_B);

    expect(result).toBe(true);
    expect(mockContextual.hasAcceptedRequest).toHaveBeenCalledWith(USER_A, USER_B);
  });

  it('returns true when shared active conversation exists (and unblocked)', async () => {
    const repo = createMockBlockedUserRepo();
    repo.isBlocked.mockResolvedValue(false);
    const mockContextual = {
      hasSharedJourney: vi.fn().mockResolvedValue(false),
      hasAcceptedRequest: vi.fn().mockResolvedValue(false),
      hasSharedConversation: vi.fn().mockResolvedValue(true),
    };
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
      contextual: mockContextual,
    });

    const result = await access.canViewProfile(USER_A, USER_B);

    expect(result).toBe(true);
    expect(mockContextual.hasSharedConversation).toHaveBeenCalledWith(USER_A, USER_B);
  });

  it('returns false for complete stranger (unblocked, but no shared context)', async () => {
    const repo = createMockBlockedUserRepo();
    repo.isBlocked.mockResolvedValue(false);
    const mockContextual = {
      hasSharedJourney: vi.fn().mockResolvedValue(false),
      hasAcceptedRequest: vi.fn().mockResolvedValue(false),
      hasSharedConversation: vi.fn().mockResolvedValue(false),
    };
    const access = new AccessService({
      blockedUsers: repo as unknown as BlockedUserRepository,
      contextual: mockContextual,
    });

    const result = await access.canViewProfile(USER_A, USER_B);

    expect(result).toBe(false);
  });
});

describe('AccessService.canViewJourney (M8)', () => {
  it('returns false for invalid UUID or missing train/date', async () => {
    const access = new AccessService();
    expect(await access.canViewJourney('not-a-uuid', '12301', '2026-09-15')).toBe(false);
    expect(await access.canViewJourney(USER_A, '', '2026-09-15')).toBe(false);
    expect(await access.canViewJourney(USER_A, '12301', '')).toBe(false);
    expect(await access.canViewJourney(USER_A, '12301', 'invalid-date')).toBe(false);
  });

  it('returns true when user has matching journey in db', async () => {
    const mockDb = {
      journey: {
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const access = new AccessService({ db: mockDb as unknown as PrismaClient });

    const result = await access.canViewJourney(USER_A, '12301', '2026-09-15');
    expect(result).toBe(true);
    expect(mockDb.journey.count).toHaveBeenCalledWith({
      where: {
        userId: USER_A,
        trainNumber: '12301',
        travelDate: new Date('2026-09-15'),
      },
    });
  });

  it('returns false when user does not have matching journey in db', async () => {
    const mockDb = {
      journey: {
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const access = new AccessService({ db: mockDb as unknown as PrismaClient });

    const result = await access.canViewJourney(USER_A, '12301', '2026-09-15');
    expect(result).toBe(false);
  });
});

describe('AccessService.usersShareJourney (M8)', () => {
  it('returns false if userA === userB or invalid inputs', async () => {
    const access = new AccessService();
    expect(await access.usersShareJourney(USER_A, USER_A, '12301', '2026-09-15')).toBe(false);
    expect(await access.usersShareJourney('bad-id', USER_B, '12301', '2026-09-15')).toBe(false);
  });

  it('returns true when both users have journey on train and date', async () => {
    const mockDb = {
      journey: {
        count: vi.fn().mockResolvedValue(1),
      },
    };
    const access = new AccessService({ db: mockDb as unknown as PrismaClient });

    const result = await access.usersShareJourney(USER_A, USER_B, '12301', '2026-09-15');
    expect(result).toBe(true);
    expect(mockDb.journey.count).toHaveBeenCalledTimes(2);
  });

  it('returns false when only one user has journey', async () => {
    const mockDb = {
      journey: {
        count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0),
      },
    };
    const access = new AccessService({ db: mockDb as unknown as PrismaClient });

    const result = await access.usersShareJourney(USER_A, USER_B, '12301', '2026-09-15');
    expect(result).toBe(false);
  });
});
