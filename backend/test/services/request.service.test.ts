import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient, Request } from '@prisma/client';
import { RequestService } from '../../src/services/request.service.js';
import { RequestRepository } from '../../src/repositories/requests.repo.js';
import { AccessService } from '../../src/services/access.service.js';
import { AppError, NotFoundError } from '../../src/utils/errors.js';
import type { RealtimeBroadcaster } from '../../src/sockets/broadcaster.js';

describe('RequestService', () => {
  let mockRequestsRepo: {
    create: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    findUserRequests: ReturnType<typeof vi.fn>;
    findAcceptedRequestsForUser: ReturnType<typeof vi.fn>;
    findActivePendingBetween: ReturnType<typeof vi.fn>;
    findAcceptedRequestBetween: ReturnType<typeof vi.fn>;
    countIncomingPending: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    deletePendingByIdAndOwner: ReturnType<typeof vi.fn>;
    deleteExpiredPending: ReturnType<typeof vi.fn>;
  };
  let mockAccess: {
    isBlocked: ReturnType<typeof vi.fn>;
    getSymmetricBlockedUserIds: ReturnType<typeof vi.fn>;
    usersShareJourney: ReturnType<typeof vi.fn>;
  };
  let service: RequestService;

  const senderId = 'aaaa0000-0000-0000-0000-000000000000';
  const recipientId = 'bbbb0000-0000-0000-0000-000000000000';

  const mockRequest: Request = {
    id: '11111111-1111-1111-1111-111111111111',
    fromUserId: senderId,
    fromEmail: null,
    fromName: 'Aarav Sharma',
    toUserId: recipientId,
    toEmail: null,
    toName: 'Priya Patel',
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    boardingStation: 'Mumbai Central',
    destinationStation: 'New Delhi',
    status: 'pending',
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    updatedAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockRequestsRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findUserRequests: vi.fn(),
      findAcceptedRequestsForUser: vi.fn(),
      findActivePendingBetween: vi.fn(),
      findAcceptedRequestBetween: vi.fn(),
      countIncomingPending: vi.fn(),
      updateStatus: vi.fn(),
      deletePendingByIdAndOwner: vi.fn(),
      deleteExpiredPending: vi.fn(),
    };

    mockAccess = {
      isBlocked: vi.fn().mockResolvedValue(false),
      getSymmetricBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
      usersShareJourney: vi.fn().mockResolvedValue(true),
    };

    service = new RequestService({
      requests: mockRequestsRepo as unknown as RequestRepository,
      access: mockAccess as unknown as AccessService,
      db: {} as PrismaClient,
    });
  });

  describe('sendRequest', () => {
    it('creates pending request when shared journey exists and users are not blocked', async () => {
      mockRequestsRepo.findActivePendingBetween.mockResolvedValue(null);
      mockRequestsRepo.create.mockResolvedValue(mockRequest);

      const result = await service.sendRequest(senderId, {
        toUserId: recipientId,
        fromName: 'Aarav Sharma',
        toName: 'Priya Patel',
        trainNumber: '12951',
        travelDate: '2026-09-15',
        boardingStation: 'Mumbai Central',
        destinationStation: 'New Delhi',
      });

      expect(mockAccess.isBlocked).toHaveBeenCalledWith(senderId, recipientId);
      expect(mockAccess.usersShareJourney).toHaveBeenCalledWith(
        senderId,
        recipientId,
        '12951',
        expect.any(Date),
      );
      expect(mockRequestsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromUserId: senderId,
          toUserId: recipientId,
          status: 'pending',
        }),
      );
      expect(result).toEqual(mockRequest);
    });

    it('rejects self-requests', async () => {
      await expect(
        service.sendRequest(senderId, {
          toUserId: senderId,
          travelDate: '2026-09-15',
          trainNumber: '12951',
        }),
      ).rejects.toThrow(AppError);
    });

    it('rejects sending request when users are blocked', async () => {
      mockAccess.isBlocked.mockResolvedValue(true);

      await expect(
        service.sendRequest(senderId, {
          toUserId: recipientId,
          travelDate: '2026-09-15',
          trainNumber: '12951',
        }),
      ).rejects.toThrow('Cannot send companion request to this user');
    });

    it('rejects sending request when users do not share an active journey', async () => {
      mockAccess.usersShareJourney.mockResolvedValue(false);

      await expect(
        service.sendRequest(senderId, {
          toUserId: recipientId,
          travelDate: '2026-09-15',
          trainNumber: '12951',
        }),
      ).rejects.toThrow('You do not share an active journey');
    });

    it('rejects duplicate request when active pending request already exists', async () => {
      mockRequestsRepo.findActivePendingBetween.mockResolvedValue(mockRequest);

      await expect(
        service.sendRequest(senderId, {
          toUserId: recipientId,
          travelDate: '2026-09-15',
          trainNumber: '12951',
        }),
      ).rejects.toThrow('An active companion request is already pending for this journey');
    });
  });

  describe('listUserRequests', () => {
    it('retrieves user requests excluding blocked users', async () => {
      mockAccess.getSymmetricBlockedUserIds.mockResolvedValue(new Set(['blocked-user']));
      mockRequestsRepo.findUserRequests.mockResolvedValue([mockRequest]);

      const result = await service.listUserRequests(senderId, 'sent');

      expect(mockRequestsRepo.findUserRequests).toHaveBeenCalledWith({
        userId: senderId,
        type: 'sent',
        excludedUserIds: ['blocked-user'],
      });
      expect(result).toEqual([mockRequest]);
    });
  });

  describe('listAcceptedRequests', () => {
    it('retrieves accepted requests excluding blocked users', async () => {
      mockAccess.getSymmetricBlockedUserIds.mockResolvedValue(new Set(['blocked-user']));
      mockRequestsRepo.findAcceptedRequestsForUser.mockResolvedValue([mockRequest]);

      const result = await service.listAcceptedRequests(senderId);

      expect(mockRequestsRepo.findAcceptedRequestsForUser).toHaveBeenCalledWith(senderId, [
        'blocked-user',
      ]);
      expect(result).toEqual([mockRequest]);
    });
  });

  describe('getIncomingPendingCount', () => {
    it('counts incoming pending requests excluding blocked senders', async () => {
      mockAccess.getSymmetricBlockedUserIds.mockResolvedValue(new Set(['blocked-user']));
      mockRequestsRepo.countIncomingPending.mockResolvedValue(2);

      const count = await service.getIncomingPendingCount(recipientId);

      expect(mockRequestsRepo.countIncomingPending).toHaveBeenCalledWith(recipientId, [
        'blocked-user',
      ]);
      expect(count).toBe(2);
    });
  });

  describe('updateStatus', () => {
    it('accepts pending request when caller is recipient', async () => {
      mockRequestsRepo.findById.mockResolvedValue(mockRequest);
      const accepted = { ...mockRequest, status: 'accepted' };
      mockRequestsRepo.updateStatus.mockResolvedValue(accepted);

      const result = await service.updateStatus(recipientId, mockRequest.id, 'accepted');

      expect(mockRequestsRepo.updateStatus).toHaveBeenCalledWith(
        mockRequest.id,
        'accepted',
        'pending',
      );
      expect(result).toEqual(accepted);
    });

    it('rejects update if caller is not recipient (masks existence with 404)', async () => {
      mockRequestsRepo.findById.mockResolvedValue(mockRequest);

      await expect(service.updateStatus('random-user', mockRequest.id, 'accepted')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('rejects update if request status is not pending', async () => {
      mockRequestsRepo.findById.mockResolvedValue({ ...mockRequest, status: 'rejected' });

      await expect(service.updateStatus(recipientId, mockRequest.id, 'accepted')).rejects.toThrow(
        'Cannot update a request that is not pending',
      );
    });

    it('rejects update if users are blocked (masks existence with 404)', async () => {
      mockRequestsRepo.findById.mockResolvedValue(mockRequest);
      mockAccess.isBlocked.mockResolvedValue(true);

      await expect(service.updateStatus(recipientId, mockRequest.id, 'accepted')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('cancelRequest', () => {
    it('deletes pending request when caller is sender', async () => {
      mockRequestsRepo.deletePendingByIdAndOwner.mockResolvedValue(true);

      await expect(service.cancelRequest(senderId, mockRequest.id)).resolves.toBeUndefined();
      expect(mockRequestsRepo.deletePendingByIdAndOwner).toHaveBeenCalledWith(
        mockRequest.id,
        senderId,
      );
    });

    it('throws 404 NotFoundError if request does not exist or not owned or not pending', async () => {
      mockRequestsRepo.deletePendingByIdAndOwner.mockResolvedValue(false);

      await expect(service.cancelRequest(recipientId, mockRequest.id)).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('cleanupExpiredRequests', () => {
    it('deletes expired pending requests using atomic query with default cutoff', async () => {
      mockRequestsRepo.deleteExpiredPending.mockResolvedValue(3);

      const count = await service.cleanupExpiredRequests(senderId);

      expect(mockRequestsRepo.deleteExpiredPending).toHaveBeenCalledWith(
        senderId,
        expect.any(Date),
      );
      expect(count).toBe(3);
    });

    it('deletes expired pending requests with custom cutoff date', async () => {
      mockRequestsRepo.deleteExpiredPending.mockResolvedValue(2);

      const count = await service.cleanupExpiredRequests(senderId, '2026-09-13');

      expect(mockRequestsRepo.deleteExpiredPending).toHaveBeenCalledWith(
        senderId,
        new Date('2026-09-13'),
      );
      expect(count).toBe(2);
    });

    it('sweeps across all users when callerId is system-cron', async () => {
      mockRequestsRepo.deleteExpiredPending.mockResolvedValue(8);

      const count = await service.cleanupExpiredRequests('system-cron');

      expect(mockRequestsRepo.deleteExpiredPending).toHaveBeenCalledWith(
        undefined,
        expect.any(Date),
      );
      expect(count).toBe(8);
    });
  });

  describe('RealtimeBroadcaster integration', () => {
    let mockBroadcaster: {
      broadcastRequestNew: ReturnType<typeof vi.fn>;
      broadcastRequestUpdated: ReturnType<typeof vi.fn>;
      broadcastCompanionsUpdated: ReturnType<typeof vi.fn>;
    };
    let serviceWithBroadcaster: RequestService;

    beforeEach(() => {
      mockBroadcaster = {
        broadcastRequestNew: vi.fn(),
        broadcastRequestUpdated: vi.fn(),
        broadcastCompanionsUpdated: vi.fn(),
      };
      serviceWithBroadcaster = new RequestService({
        requests: mockRequestsRepo as unknown as RequestRepository,
        access: mockAccess as unknown as AccessService,
        broadcaster: mockBroadcaster as unknown as RealtimeBroadcaster,
      });
    });

    it('broadcasts request:new to recipient user room on sendRequest', async () => {
      mockAccess.isBlocked.mockResolvedValue(false);
      mockAccess.usersShareJourney.mockResolvedValue(true);
      mockRequestsRepo.findActivePendingBetween.mockResolvedValue(null);
      mockRequestsRepo.create.mockResolvedValue(mockRequest);

      await serviceWithBroadcaster.sendRequest(senderId, {
        toUserId: recipientId,
        trainNumber: '12951',
        travelDate: '2026-09-15',
      });

      expect(mockBroadcaster.broadcastRequestNew).toHaveBeenCalledWith(
        recipientId,
        expect.objectContaining({
          id: mockRequest.id,
          toUserId: recipientId,
        }),
      );
    });

    it('broadcasts request:updated and companions:updated on acceptRequest', async () => {
      const pendingRequest: Request = { ...mockRequest, status: 'pending' };
      const acceptedRequest: Request = { ...mockRequest, status: 'accepted' };

      mockRequestsRepo.findById.mockResolvedValue(pendingRequest);
      mockAccess.isBlocked.mockResolvedValue(false);
      mockRequestsRepo.updateStatus.mockResolvedValue(acceptedRequest);

      await serviceWithBroadcaster.updateStatus(recipientId, mockRequest.id, 'accepted');

      expect(mockBroadcaster.broadcastRequestUpdated).toHaveBeenCalledWith(
        [senderId, recipientId],
        expect.objectContaining({
          id: mockRequest.id,
          status: 'accepted',
        }),
      );
      expect(mockBroadcaster.broadcastCompanionsUpdated).toHaveBeenCalledWith(
        [senderId, recipientId],
        expect.objectContaining({
          requestId: mockRequest.id,
          status: 'accepted',
        }),
      );
    });

    it('broadcasts request:updated with cancelled status on cancelRequest', async () => {
      const pendingRequest: Request = { ...mockRequest, status: 'pending' };
      mockRequestsRepo.findById.mockResolvedValue(pendingRequest);
      mockRequestsRepo.deletePendingByIdAndOwner.mockResolvedValue(true);

      await serviceWithBroadcaster.cancelRequest(senderId, mockRequest.id);

      expect(mockBroadcaster.broadcastRequestUpdated).toHaveBeenCalledWith(
        [senderId, recipientId],
        expect.objectContaining({
          id: mockRequest.id,
          status: 'cancelled',
        }),
      );
    });
  });
});
