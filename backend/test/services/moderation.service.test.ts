import { describe, expect, it, vi } from 'vitest';
import { Prisma, type User } from '@prisma/client';
import { ModerationService } from '../../src/services/moderation.service.js';
import type { BlockedUserRepository } from '../../src/repositories/blocked-users.repo.js';
import type { UserReportRepository } from '../../src/repositories/user-reports.repo.js';
import type { UserRepository } from '../../src/repositories/users.repo.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const BLOCK_ID = '11111111-1111-4000-8000-111111111111';
const REPORT_ID = '22222222-2222-4000-8000-222222222222';

function createHarness() {
  const blockedUsers = {
    findByPair: vi.fn(),
    isBlocked: vi.fn(),
    findBlockedIdsByBlocker: vi.fn(),
    findSymmetricBlockedIds: vi.fn(),
    create: vi.fn(),
    deleteByPair: vi.fn(),
  };

  const userReports = {
    create: vi.fn(),
    findById: vi.fn(),
    findByReporterId: vi.fn(),
    findByReportedId: vi.fn(),
  };

  const users = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    updatePasswordHash: vi.fn(),
    confirmEmail: vi.fn(),
    deleteById: vi.fn(),
  };

  const service = new ModerationService({
    blockedUsers: blockedUsers as unknown as BlockedUserRepository,
    userReports: userReports as unknown as UserReportRepository,
    users: users as unknown as UserRepository,
  });

  return { service, blockedUsers, userReports, users };
}

describe('ModerationService — Blocking', () => {
  it('rejects self-block with 400 VALIDATION_ERROR', async () => {
    const { service, users, blockedUsers } = createHarness();

    await expect(service.blockUser(USER1, USER1)).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Cannot block yourself',
    });

    expect(users.findById).not.toHaveBeenCalled();
    expect(blockedUsers.create).not.toHaveBeenCalled();
  });

  it('rejects blocking a non-existent target with 404 USER_NOT_FOUND', async () => {
    const { service, users, blockedUsers } = createHarness();
    users.findById.mockResolvedValue(null);

    await expect(service.blockUser(USER1, USER2)).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });

    expect(users.findById).toHaveBeenCalledWith(USER2);
    expect(blockedUsers.create).not.toHaveBeenCalled();
  });

  it('creates and returns a new block when valid target exists', async () => {
    const { service, users, blockedUsers } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    blockedUsers.findByPair.mockResolvedValue(null);
    const mockBlock = {
      id: BLOCK_ID,
      blockerId: USER1,
      blockedId: USER2,
      createdAt: new Date(),
    };
    blockedUsers.create.mockResolvedValue(mockBlock);

    const result = await service.blockUser(USER1, USER2);

    expect(result).toEqual(mockBlock);
    expect(blockedUsers.create).toHaveBeenCalledWith({
      blockerId: USER1,
      blockedId: USER2,
    });
  });

  it('handles duplicate block idempotently (returns existing record without error)', async () => {
    const { service, users, blockedUsers } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    const existingBlock = {
      id: BLOCK_ID,
      blockerId: USER1,
      blockedId: USER2,
      createdAt: new Date(),
    };
    blockedUsers.findByPair.mockResolvedValue(existingBlock);

    const result = await service.blockUser(USER1, USER2);

    expect(result).toEqual(existingBlock);
    expect(blockedUsers.create).not.toHaveBeenCalled();
  });

  it('absorbs racing duplicate insert unique violation (P2002) and returns existing block', async () => {
    const { service, users, blockedUsers } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    blockedUsers.findByPair.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: BLOCK_ID,
      blockerId: USER1,
      blockedId: USER2,
      createdAt: new Date(),
    });
    blockedUsers.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on (blocker_id, blocked_id)',
        {
          code: 'P2002',
          clientVersion: '6.0.0',
        },
      ),
    );

    const result = await service.blockUser(USER1, USER2);

    expect(result.id).toBe(BLOCK_ID);
  });

  it('unblockUser deletes the directional block row idempotently', async () => {
    const { service, blockedUsers } = createHarness();
    blockedUsers.deleteByPair.mockResolvedValue(true);

    await expect(service.unblockUser(USER1, USER2)).resolves.toBeUndefined();
    expect(blockedUsers.deleteByPair).toHaveBeenCalledWith(USER1, USER2);
  });

  it('getBlockedUsers returns array of { blocked_id } objects', async () => {
    const { service, blockedUsers } = createHarness();
    blockedUsers.findBlockedIdsByBlocker.mockResolvedValue([USER2]);

    const result = await service.getBlockedUsers(USER1);

    expect(result).toEqual([{ blocked_id: USER2 }]);
    expect(blockedUsers.findBlockedIdsByBlocker).toHaveBeenCalledWith(USER1);
  });
});

describe('ModerationService — Reporting', () => {
  it('rejects self-reporting with 400 VALIDATION_ERROR', async () => {
    const { service, users, userReports } = createHarness();

    await expect(service.reportUser(USER1, USER1, 'reason')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Cannot report yourself',
    });

    expect(users.findById).not.toHaveBeenCalled();
    expect(userReports.create).not.toHaveBeenCalled();
  });

  it('rejects reporting a non-existent target with 404 USER_NOT_FOUND', async () => {
    const { service, users, userReports } = createHarness();
    users.findById.mockResolvedValue(null);

    await expect(service.reportUser(USER1, USER2, 'reason')).rejects.toMatchObject({
      statusCode: 404,
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });

    expect(users.findById).toHaveBeenCalledWith(USER2);
    expect(userReports.create).not.toHaveBeenCalled();
  });

  it('trims reason and creates report', async () => {
    const { service, users, userReports } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    const mockReport = {
      id: REPORT_ID,
      reporterId: USER1,
      reportedId: USER2,
      reason: 'Spamming messages',
      createdAt: new Date(),
    };
    userReports.create.mockResolvedValue(mockReport);

    const result = await service.reportUser(USER1, USER2, '  Spamming messages  ');

    expect(result).toEqual(mockReport);
    expect(userReports.create).toHaveBeenCalledWith({
      reporterId: USER1,
      reportedId: USER2,
      reason: 'Spamming messages',
    });
  });

  it('normalizes empty or whitespace-only reason to null', async () => {
    const { service, users, userReports } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    userReports.create.mockResolvedValue({ id: REPORT_ID });

    await service.reportUser(USER1, USER2, '   ');

    expect(userReports.create).toHaveBeenCalledWith({
      reporterId: USER1,
      reportedId: USER2,
      reason: null,
    });
  });

  it('allows duplicate reports for the same user', async () => {
    const { service, users, userReports } = createHarness();
    users.findById.mockResolvedValue({ id: USER2 } as User);
    userReports.create.mockResolvedValue({ id: REPORT_ID });

    await service.reportUser(USER1, USER2, 'First report');
    await service.reportUser(USER1, USER2, 'Second report');

    expect(userReports.create).toHaveBeenCalledTimes(2);
  });
});
