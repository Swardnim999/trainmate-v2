import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request as ExpressRequest, Response } from 'express';
import { RequestController } from '../../src/controllers/request.controller.js';
import { RequestService } from '../../src/services/request.service.js';
import type { Request } from '@prisma/client';

describe('RequestController', () => {
  let mockService: {
    listUserRequests: ReturnType<typeof vi.fn>;
    sendRequest: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
    cancelRequest: ReturnType<typeof vi.fn>;
    cleanupExpiredRequests: ReturnType<typeof vi.fn>;
    listAcceptedRequests: ReturnType<typeof vi.fn>;
    getIncomingPendingCount: ReturnType<typeof vi.fn>;
  };
  let controller: RequestController;
  let mockReq: Partial<ExpressRequest>;
  let mockRes: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;
  let sendMock: ReturnType<typeof vi.fn>;

  const mockRequest: Request = {
    id: '11111111-1111-1111-1111-111111111111',
    fromUserId: 'aaaa0000-0000-0000-0000-000000000000',
    fromEmail: null,
    fromName: 'Aarav Sharma',
    toUserId: 'bbbb0000-0000-0000-0000-000000000000',
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
    mockService = {
      listUserRequests: vi.fn(),
      sendRequest: vi.fn(),
      updateStatus: vi.fn(),
      cancelRequest: vi.fn(),
      cleanupExpiredRequests: vi.fn(),
      listAcceptedRequests: vi.fn(),
      getIncomingPendingCount: vi.fn(),
    };

    controller = new RequestController({
      requestService: mockService as unknown as RequestService,
    });

    jsonMock = vi.fn();
    sendMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock, send: sendMock });

    mockRes = {
      status: statusMock,
      json: jsonMock,
      send: sendMock,
    };
  });

  describe('getMyRequests', () => {
    it('returns 200 with serialized list', async () => {
      mockReq = {
        user: { id: 'user-1', email: 'test@example.com' },
        validated: { query: { type: 'all' } },
      };
      mockService.listUserRequests.mockResolvedValue([mockRequest]);

      await controller.getMyRequests(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.listUserRequests).toHaveBeenCalledWith('user-1', 'all');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: mockRequest.id })]),
      );
    });
  });

  describe('sendRequest', () => {
    it('returns 201 with created serialized request', async () => {
      mockReq = {
        user: { id: 'user-1', email: 'test@example.com' },
        validated: {
          body: {
            toUserId: 'user-2',
            fromName: 'Aarav',
            toName: 'Priya',
            trainNumber: '12951',
            travelDate: '2026-09-15',
          },
        },
      };
      mockService.sendRequest.mockResolvedValue(mockRequest);

      await controller.sendRequest(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.sendRequest).toHaveBeenCalledWith('user-1', mockReq.validated!.body);
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockRequest.id, status: 'pending' }),
      );
    });
  });

  describe('updateRequestStatus', () => {
    it('returns 200 with updated serialized request', async () => {
      mockReq = {
        user: { id: 'user-2', email: 'test@example.com' },
        validated: {
          params: { id: mockRequest.id },
          body: { status: 'accepted' },
        },
      };
      const accepted = { ...mockRequest, status: 'accepted' };
      mockService.updateStatus.mockResolvedValue(accepted);

      await controller.updateRequestStatus(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.updateStatus).toHaveBeenCalledWith('user-2', mockRequest.id, 'accepted');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockRequest.id, status: 'accepted' }),
      );
    });
  });

  describe('cancelRequest', () => {
    it('returns 204 on successful cancel', async () => {
      mockReq = {
        user: { id: 'user-1', email: 'test@example.com' },
        validated: { params: { id: mockRequest.id } },
      };
      mockService.cancelRequest.mockResolvedValue(undefined);

      await controller.cancelRequest(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.cancelRequest).toHaveBeenCalledWith('user-1', mockRequest.id);
      expect(statusMock).toHaveBeenCalledWith(204);
      expect(sendMock).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredRequests', () => {
    it('returns 200 with count of cleaned up requests', async () => {
      mockReq = {
        user: { id: 'user-1', email: 'test@example.com' },
        validated: { body: { cutoffDate: '2026-09-13' } },
      };
      mockService.cleanupExpiredRequests.mockResolvedValue(3);

      await controller.cleanupExpiredRequests(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.cleanupExpiredRequests).toHaveBeenCalledWith('user-1', '2026-09-13');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ count: 3 });
    });
  });

  describe('getMyAcceptedRequests', () => {
    it('returns 200 with accepted requests list', async () => {
      mockReq = {
        user: { id: 'user-1', email: 'test@example.com' },
        validated: {},
      };
      const accepted = { ...mockRequest, status: 'accepted' };
      mockService.listAcceptedRequests.mockResolvedValue([accepted]);

      await controller.getMyAcceptedRequests(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.listAcceptedRequests).toHaveBeenCalledWith('user-1');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ status: 'accepted' })]),
      );
    });
  });

  describe('getIncomingPendingCount', () => {
    it('returns 200 with incoming pending count', async () => {
      mockReq = {
        user: { id: 'user-2', email: 'test@example.com' },
        validated: {},
      };
      mockService.getIncomingPendingCount.mockResolvedValue(5);

      await controller.getIncomingPendingCount(mockReq as ExpressRequest, mockRes as Response);

      expect(mockService.getIncomingPendingCount).toHaveBeenCalledWith('user-2');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith({ count: 5 });
    });
  });
});
