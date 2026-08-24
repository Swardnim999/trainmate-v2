import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient, Request } from '@prisma/client';
import { RequestRepository } from '../../src/repositories/requests.repo.js';

describe('RequestRepository', () => {
  let mockPrisma: {
    request: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  let repo: RequestRepository;

  const mockRequest: Request = {
    id: '11111111-1111-1111-1111-111111111111',
    fromUserId: 'aaaa0000-0000-0000-0000-000000000000',
    fromEmail: null,
    fromName: 'Aarav',
    toUserId: 'bbbb0000-0000-0000-0000-000000000000',
    toEmail: null,
    toName: 'Priya',
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    boardingStation: 'Mumbai Central',
    destinationStation: 'New Delhi',
    status: 'pending',
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
    updatedAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      request: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    repo = new RequestRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findById', () => {
    it('queries request by ID', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(mockRequest);

      const result = await repo.findById(mockRequest.id);

      expect(mockPrisma.request.findUnique).toHaveBeenCalledWith({
        where: { id: mockRequest.id },
      });
      expect(result).toEqual(mockRequest);
    });

    it('returns null when request not found', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(null);

      const result = await repo.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('findUserRequests', () => {
    it('queries all sent and received requests by default', async () => {
      mockPrisma.request.findMany.mockResolvedValue([mockRequest]);

      const result = await repo.findUserRequests({
        userId: 'aaaa0000-0000-0000-0000-000000000000',
      });

      expect(mockPrisma.request.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { fromUserId: 'aaaa0000-0000-0000-0000-000000000000', toUserId: undefined },
            { toUserId: 'aaaa0000-0000-0000-0000-000000000000', fromUserId: undefined },
          ],
          status: undefined,
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(result).toEqual([mockRequest]);
    });

    it('filters by type=sent and excludes blocked user IDs', async () => {
      mockPrisma.request.findMany.mockResolvedValue([mockRequest]);

      const result = await repo.findUserRequests({
        userId: 'aaaa0000-0000-0000-0000-000000000000',
        type: 'sent',
        excludedUserIds: ['blocked-user-id'],
      });

      expect(mockPrisma.request.findMany).toHaveBeenCalledWith({
        where: {
          fromUserId: 'aaaa0000-0000-0000-0000-000000000000',
          toUserId: { notIn: ['blocked-user-id'] },
          status: undefined,
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(result).toEqual([mockRequest]);
    });

    it('filters by type=received and status', async () => {
      mockPrisma.request.findMany.mockResolvedValue([mockRequest]);

      const result = await repo.findUserRequests({
        userId: 'bbbb0000-0000-0000-0000-000000000000',
        type: 'received',
        status: 'pending',
      });

      expect(mockPrisma.request.findMany).toHaveBeenCalledWith({
        where: {
          toUserId: 'bbbb0000-0000-0000-0000-000000000000',
          fromUserId: undefined,
          status: 'pending',
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(result).toEqual([mockRequest]);
    });
  });

  describe('findAcceptedRequestsForUser', () => {
    it('queries accepted requests excluding blocked IDs', async () => {
      const acceptedRequest = { ...mockRequest, status: 'accepted' };
      mockPrisma.request.findMany.mockResolvedValue([acceptedRequest]);

      const result = await repo.findAcceptedRequestsForUser(
        'aaaa0000-0000-0000-0000-000000000000',
        ['blocked-id'],
      );

      expect(mockPrisma.request.findMany).toHaveBeenCalledWith({
        where: {
          status: 'accepted',
          OR: [
            {
              fromUserId: 'aaaa0000-0000-0000-0000-000000000000',
              toUserId: { notIn: ['blocked-id'] },
            },
            {
              toUserId: 'aaaa0000-0000-0000-0000-000000000000',
              fromUserId: { notIn: ['blocked-id'] },
            },
          ],
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(result).toEqual([acceptedRequest]);
    });
  });

  describe('findActivePendingBetween', () => {
    it('queries active pending request with train and travel date', async () => {
      mockPrisma.request.findFirst.mockResolvedValue(mockRequest);

      const result = await repo.findActivePendingBetween(
        mockRequest.fromUserId,
        mockRequest.toUserId,
        mockRequest.trainNumber,
        mockRequest.travelDate,
      );

      expect(mockPrisma.request.findFirst).toHaveBeenCalledWith({
        where: {
          fromUserId: mockRequest.fromUserId,
          toUserId: mockRequest.toUserId,
          status: 'pending',
          trainNumber: mockRequest.trainNumber,
          travelDate: mockRequest.travelDate,
        },
      });
      expect(result).toEqual(mockRequest);
    });
  });

  describe('findAcceptedRequestBetween', () => {
    it('queries accepted request between two users in either direction', async () => {
      const accepted = { ...mockRequest, status: 'accepted' };
      mockPrisma.request.findFirst.mockResolvedValue(accepted);

      const result = await repo.findAcceptedRequestBetween(
        'user-1',
        'user-2',
        '12951',
        mockRequest.travelDate,
      );

      expect(mockPrisma.request.findFirst).toHaveBeenCalledWith({
        where: {
          status: 'accepted',
          OR: [
            { fromUserId: 'user-1', toUserId: 'user-2' },
            { fromUserId: 'user-2', toUserId: 'user-1' },
          ],
          trainNumber: '12951',
          travelDate: mockRequest.travelDate,
        },
      });
      expect(result).toEqual(accepted);
    });
  });

  describe('countIncomingPending', () => {
    it('counts incoming pending requests excluding blocked senders', async () => {
      mockPrisma.request.count.mockResolvedValue(3);

      const count = await repo.countIncomingPending('my-user-id', ['blocked-user']);

      expect(mockPrisma.request.count).toHaveBeenCalledWith({
        where: {
          toUserId: 'my-user-id',
          status: 'pending',
          fromUserId: { notIn: ['blocked-user'] },
        },
      });
      expect(count).toBe(3);
    });
  });

  describe('create', () => {
    it('creates request with default pending status', async () => {
      mockPrisma.request.create.mockResolvedValue(mockRequest);

      const result = await repo.create({
        fromUserId: mockRequest.fromUserId,
        fromName: mockRequest.fromName,
        toUserId: mockRequest.toUserId,
        toName: mockRequest.toName,
        trainNumber: mockRequest.trainNumber,
        travelDate: mockRequest.travelDate,
        boardingStation: mockRequest.boardingStation,
        destinationStation: mockRequest.destinationStation,
      });

      expect(mockPrisma.request.create).toHaveBeenCalledWith({
        data: {
          fromUserId: mockRequest.fromUserId,
          fromEmail: null,
          fromName: mockRequest.fromName,
          toUserId: mockRequest.toUserId,
          toEmail: null,
          toName: mockRequest.toName,
          trainNumber: mockRequest.trainNumber,
          travelDate: mockRequest.travelDate,
          boardingStation: mockRequest.boardingStation,
          destinationStation: mockRequest.destinationStation,
          status: 'pending',
        },
      });
      expect(result).toEqual(mockRequest);
    });
  });

  describe('updateStatus', () => {
    it('updates status from pending to accepted', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 1 });
      const accepted = { ...mockRequest, status: 'accepted' };
      mockPrisma.request.findUnique.mockResolvedValue(accepted);

      const result = await repo.updateStatus(mockRequest.id, 'accepted', 'pending');

      expect(mockPrisma.request.updateMany).toHaveBeenCalledWith({
        where: {
          id: mockRequest.id,
          status: 'pending',
        },
        data: {
          status: 'accepted',
        },
      });
      expect(result).toEqual(accepted);
    });

    it('returns null when no rows matched updateMany (race or already non-pending)', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 0 });

      const result = await repo.updateStatus(mockRequest.id, 'accepted', 'pending');

      expect(result).toBeNull();
      expect(mockPrisma.request.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deletePendingByIdAndOwner', () => {
    it('deletes pending request by id and owner', async () => {
      mockPrisma.request.deleteMany.mockResolvedValue({ count: 1 });

      const deleted = await repo.deletePendingByIdAndOwner(mockRequest.id, mockRequest.fromUserId);

      expect(mockPrisma.request.deleteMany).toHaveBeenCalledWith({
        where: {
          id: mockRequest.id,
          fromUserId: mockRequest.fromUserId,
          status: 'pending',
        },
      });
      expect(deleted).toBe(true);
    });

    it('returns false when request not found or not in pending status', async () => {
      mockPrisma.request.deleteMany.mockResolvedValue({ count: 0 });

      const deleted = await repo.deletePendingByIdAndOwner(mockRequest.id, 'other-user');
      expect(deleted).toBe(false);
    });
  });

  describe('deleteExpiredPending', () => {
    it('deletes expired pending requests prior to cutoff date in single query', async () => {
      mockPrisma.request.deleteMany.mockResolvedValue({ count: 4 });
      const cutoff = new Date('2026-09-13T00:00:00.000Z');

      const count = await repo.deleteExpiredPending(mockRequest.fromUserId, cutoff);

      expect(mockPrisma.request.deleteMany).toHaveBeenCalledWith({
        where: {
          fromUserId: mockRequest.fromUserId,
          status: 'pending',
          travelDate: {
            lt: cutoff,
          },
        },
      });
      expect(count).toBe(4);
    });
  });
});
