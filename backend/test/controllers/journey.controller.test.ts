import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import { JourneyController } from '../../src/controllers/journey.controller.js';
import type { JourneyService } from '../../src/services/journey.service.js';

describe('JourneyController (Unit)', () => {
  let controller: JourneyController;
  let mockJourneyService: {
    listUserJourneys: ReturnType<typeof vi.fn>;
    createJourney: ReturnType<typeof vi.fn>;
    deleteJourney: ReturnType<typeof vi.fn>;
    findCompanions: ReturnType<typeof vi.fn>;
  };
  let mockReq: Partial<Request> & { validated?: Record<string, unknown> };
  let mockRes: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockJourneyService = {
      listUserJourneys: vi.fn(),
      createJourney: vi.fn(),
      deleteJourney: vi.fn(),
      findCompanions: vi.fn(),
    };
    controller = new JourneyController({
      journeyService: mockJourneyService as unknown as JourneyService,
    });

    mockReq = {
      user: { id: 'u-caller' } as unknown as Express.User,
      body: {},
      params: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  describe('getMyJourneys', () => {
    it('returns serialized user journeys with 200 OK', async () => {
      const mockJourney = {
        id: 'j-1',
        userId: 'u-caller',
        userName: 'Alex',
        trainNumber: '12301',
        trainName: 'Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: 'B1',
        boardingStation: 'NDLS',
        destinationStation: 'HWH',
        college: 'IIT',
        gender: 'prefer-not-to-say',
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      mockJourneyService.listUserJourneys.mockResolvedValue([mockJourney]);

      await controller.getMyJourneys(mockReq as Request, mockRes as unknown as Response);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith([
        {
          id: 'j-1',
          user_id: 'u-caller',
          user_name: 'Alex',
          train_number: '12301',
          train_name: 'Rajdhani',
          travel_date: '2026-09-15',
          coach: 'B1',
          boarding_station: 'NDLS',
          destination_station: 'HWH',
          college: 'IIT',
          gender: 'prefer-not-to-say',
          created_at: '2026-08-24T12:00:00.000Z',
        },
      ]);
    });
  });

  describe('createJourney', () => {
    it('creates journey and returns serialized response with 201 Created', async () => {
      const mockCreated = {
        id: 'j-created',
        userId: 'u-caller',
        userName: 'Alex',
        trainNumber: '12301',
        trainName: 'Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: null,
        boardingStation: null,
        destinationStation: null,
        college: null,
        gender: null,
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      mockReq.validated = { body: { trainNumber: '12301', travelDate: '2026-09-15' } };
      mockJourneyService.createJourney.mockResolvedValue(mockCreated);

      await controller.createJourney(mockReq as Request, mockRes as unknown as Response);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'j-created',
          train_number: '12301',
          travel_date: '2026-09-15',
        }),
      );
    });
  });

  describe('deleteJourney', () => {
    it('deletes journey and returns 204 No Content', async () => {
      mockReq.validated = { params: { id: 'j-to-delete' } };
      mockJourneyService.deleteJourney.mockResolvedValue(undefined);

      await controller.deleteJourney(mockReq as Request, mockRes as unknown as Response);

      expect(mockJourneyService.deleteJourney).toHaveBeenCalledWith('j-to-delete', 'u-caller');
      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.send).toHaveBeenCalled();
    });
  });

  describe('getCompanions', () => {
    it('returns companion journeys with 200 OK', async () => {
      mockReq.validated = { params: { trainNumber: '12301', travelDate: '2026-09-15' } };
      const mockCompanion = {
        id: 'j-comp',
        userId: 'u-comp',
        userName: 'Sam',
        trainNumber: '12301',
        trainName: 'Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: 'B2',
        boardingStation: 'NDLS',
        destinationStation: 'CNB',
        college: 'BITS',
        gender: 'female',
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      mockJourneyService.findCompanions.mockResolvedValue([mockCompanion]);

      await controller.getCompanions(mockReq as Request, mockRes as unknown as Response);

      expect(mockJourneyService.findCompanions).toHaveBeenCalledWith(
        'u-caller',
        '12301',
        '2026-09-15',
      );
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith([
        expect.objectContaining({
          id: 'j-comp',
          user_id: 'u-comp',
          train_number: '12301',
        }),
      ]);
    });
  });
});
