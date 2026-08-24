import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ModerationController } from '../../src/controllers/moderation.controller.js';
import type { ModerationService } from '../../src/services/moderation.service.js';
import type { BlockedUser, UserReport } from '@prisma/client';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const BLOCK_ID = '11111111-1111-4000-8000-111111111111';
const REPORT_ID = '22222222-2222-4000-8000-222222222222';

function createMockService() {
  return {
    getBlockedUsers: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    reportUser: vi.fn(),
  };
}

function createMockRes() {
  const statusMock = vi.fn().mockReturnThis();
  const jsonMock = vi.fn().mockReturnThis();
  const endMock = vi.fn().mockReturnThis();

  const res = {
    status: statusMock,
    json: jsonMock,
    end: endMock,
  } as unknown as Response;

  return { res, statusMock, jsonMock, endMock };
}

describe('ModerationController', () => {
  it('getBlockedUsers extracts req.user.id, calls service, and returns 200 with result', async () => {
    const service = createMockService();
    const controller = new ModerationController({
      moderation: service as unknown as ModerationService,
    });
    service.getBlockedUsers.mockResolvedValue([{ blocked_id: USER2 }]);

    const req = {
      user: { id: USER1, email: 'u1@example.com' },
    } as unknown as Request;
    const { res, statusMock, jsonMock } = createMockRes();

    await controller.getBlockedUsers(req, res);

    expect(service.getBlockedUsers).toHaveBeenCalledWith(USER1);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith([{ blocked_id: USER2 }]);
  });

  it('blockUser reads validated.body.blocked_id, calls service, and returns 200', async () => {
    const service = createMockService();
    const controller = new ModerationController({
      moderation: service as unknown as ModerationService,
    });
    const mockBlock = {
      id: BLOCK_ID,
      blockerId: USER1,
      blockedId: USER2,
      createdAt: new Date(),
    } as BlockedUser;
    service.blockUser.mockResolvedValue(mockBlock);

    const req = {
      user: { id: USER1, email: 'u1@example.com' },
      validated: { body: { blocked_id: USER2 } },
    } as unknown as Request;
    const { res, statusMock, jsonMock } = createMockRes();

    await controller.blockUser(req, res);

    expect(service.blockUser).toHaveBeenCalledWith(USER1, USER2);
    expect(statusMock).toHaveBeenCalledWith(200);
    expect(jsonMock).toHaveBeenCalledWith(mockBlock);
  });

  it('unblockUser reads validated.params.blockedId, calls service, and returns 204', async () => {
    const service = createMockService();
    const controller = new ModerationController({
      moderation: service as unknown as ModerationService,
    });
    service.unblockUser.mockResolvedValue(undefined);

    const req = {
      user: { id: USER1, email: 'u1@example.com' },
      validated: { params: { blockedId: USER2 } },
    } as unknown as Request;
    const { res, statusMock, endMock } = createMockRes();

    await controller.unblockUser(req, res);

    expect(service.unblockUser).toHaveBeenCalledWith(USER1, USER2);
    expect(statusMock).toHaveBeenCalledWith(204);
    expect(endMock).toHaveBeenCalledTimes(1);
  });

  it('reportUser reads validated.body.reported_id and reason, calls service, and returns 201', async () => {
    const service = createMockService();
    const controller = new ModerationController({
      moderation: service as unknown as ModerationService,
    });
    const mockReport = {
      id: REPORT_ID,
      reporterId: USER1,
      reportedId: USER2,
      reason: 'Harassment',
      createdAt: new Date(),
    } as UserReport;
    service.reportUser.mockResolvedValue(mockReport);

    const req = {
      user: { id: USER1, email: 'u1@example.com' },
      validated: { body: { reported_id: USER2, reason: 'Harassment' } },
    } as unknown as Request;
    const { res, statusMock, jsonMock } = createMockRes();

    await controller.reportUser(req, res);

    expect(service.reportUser).toHaveBeenCalledWith(USER1, USER2, 'Harassment');
    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith(mockReport);
  });
});
