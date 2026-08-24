import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { TrainController } from '../../src/controllers/train.controller.js';
import type { TrainService } from '../../src/services/train.service.js';

describe('TrainController (Unit)', () => {
  let controller: TrainController;
  let mockTrainService: {
    search: ReturnType<typeof vi.fn>;
    logUnverifiedTrain: ReturnType<typeof vi.fn>;
  };
  let mockReq: Partial<Request> & { validated?: Record<string, unknown> };
  let mockRes: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTrainService = {
      search: vi.fn(),
      logUnverifiedTrain: vi.fn(),
    };
    controller = new TrainController({
      trainService: mockTrainService as unknown as TrainService,
    });

    mockReq = {
      user: { id: 'u-caller' } as unknown as Express.User,
      body: {},
      query: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('searchTrains', () => {
    it('searches trains and returns 200 OK', async () => {
      mockReq.validated = { query: { q: 'raj', limit: 10 } };
      const mockTrains = [{ trainNumber: '12301', trainName: 'Rajdhani Express' }];
      mockTrainService.search.mockResolvedValue(mockTrains);

      await controller.searchTrains(mockReq as Request, mockRes as unknown as Response);

      expect(mockTrainService.search).toHaveBeenCalledWith('raj', 10);
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith([
        {
          train_number: '12301',
          train_name: 'Rajdhani Express',
        },
      ]);
    });
  });

  describe('logUnverifiedTrain', () => {
    it('logs unverified train and returns 201 Created', async () => {
      mockReq.validated = { body: { trainNumber: '99999', trainName: 'Summer Spl' } };
      const mockEntry = {
        id: 'uv-1',
        trainNumber: '99999',
        trainName: 'Summer Spl',
        submittedBy: 'u-caller',
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      mockTrainService.logUnverifiedTrain.mockResolvedValue(mockEntry);

      await controller.logUnverifiedTrain(mockReq as Request, mockRes as unknown as Response);

      expect(mockTrainService.logUnverifiedTrain).toHaveBeenCalledWith({
        trainNumber: '99999',
        trainName: 'Summer Spl',
        submittedBy: 'u-caller',
      });
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        id: 'uv-1',
        train_number: '99999',
        train_name: 'Summer Spl',
        submitted_by: 'u-caller',
        created_at: '2026-08-24T12:00:00.000Z',
      });
    });
  });
});
