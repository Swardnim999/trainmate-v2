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
