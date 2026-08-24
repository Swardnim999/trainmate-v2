import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { JourneyService } from '../../src/services/journey.service.js';
import type { JourneyRepository } from '../../src/repositories/journeys.repo.js';
import type { TrainRepository } from '../../src/repositories/trains.repo.js';
import type { UnverifiedTrainRepository } from '../../src/repositories/unverified-trains.repo.js';
import type { ProfileRepository } from '../../src/repositories/profiles.repo.js';
import type { AccessService } from '../../src/services/access.service.js';
import { AppError } from '../../src/utils/errors.js';

describe('JourneyService (Unit)', () => {
  let service: JourneyService;
  let mockJourneyRepo: {
    findByUserId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteByIdAndUser: ReturnType<typeof vi.fn>;
    findCompanions: ReturnType<typeof vi.fn>;
  };
  let mockTrainRepo: {
    findByNumber: ReturnType<typeof vi.fn>;
  };
  let mockUnverifiedRepo: {
    create: ReturnType<typeof vi.fn>;
  };
  let mockProfileRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockAccessService: {
    getSymmetricBlockedUserIds: ReturnType<typeof vi.fn>;
  };
  let mockPrisma: {
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockJourneyRepo = {
      findByUserId: vi.fn(),
      create: vi.fn(),
      deleteByIdAndUser: vi.fn(),
      findCompanions: vi.fn(),
    };
    mockTrainRepo = {
      findByNumber: vi.fn(),
    };
    mockUnverifiedRepo = {
      create: vi.fn(),
    };
    mockProfileRepo = {
      findById: vi.fn(),
    };
    mockAccessService = {
      getSymmetricBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
    };
    mockPrisma = {
      $transaction: vi.fn((cb) => cb(mockPrisma)),
    };

    service = new JourneyService({
      journeys: mockJourneyRepo as unknown as JourneyRepository,
      trains: mockTrainRepo as unknown as TrainRepository,
      unverifiedTrains: mockUnverifiedRepo as unknown as UnverifiedTrainRepository,
      profiles: mockProfileRepo as unknown as ProfileRepository,
      access: mockAccessService as unknown as AccessService,
      db: mockPrisma as unknown as PrismaClient,
    });
  });

  describe('listUserJourneys', () => {
    it('returns user journeys from repository', async () => {
      const mockList = [{ id: 'j-1', userId: 'u-1' }];
      mockJourneyRepo.findByUserId.mockResolvedValue(mockList);

      const result = await service.listUserJourneys('u-1');
      expect(result).toEqual(mockList);
      expect(mockJourneyRepo.findByUserId).toHaveBeenCalledWith('u-1');
    });
  });

  describe('createJourney', () => {
    it('throws badRequest on invalid date', async () => {
      await expect(
        service.createJourney('u-1', {
          trainNumber: '12301',
          travelDate: 'invalid-date',
        }),
      ).rejects.toThrow(AppError);
    });

    it('creates verified journey without unverified logging when train exists', async () => {
      mockTrainRepo.findByNumber.mockResolvedValue({
        trainNumber: '12301',
        trainName: 'Howrah Rajdhani Express',
      });
      mockProfileRepo.findById.mockResolvedValue({ id: 'u-1', name: 'Alex Profile' });
      const mockCreated = { id: 'j-1', trainNumber: '12301' };
      mockJourneyRepo.create.mockResolvedValue(mockCreated);

      const result = await service.createJourney('u-1', {
        trainNumber: '12301',
        travelDate: '2026-09-15',
        isTrainVerified: true,
      });

      expect(result).toEqual(mockCreated);
      expect(mockUnverifiedRepo.create).not.toHaveBeenCalled();
      expect(mockJourneyRepo.create).toHaveBeenCalledWith({
        userId: 'u-1',
        userName: 'Alex Profile',
        trainNumber: '12301',
        trainName: 'Howrah Rajdhani Express',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: null,
        boardingStation: null,
        destinationStation: null,
        college: null,
        gender: null,
      });
    });

    it('creates unverified journey and logs to unverified_trains in transaction when unverified', async () => {
      mockTrainRepo.findByNumber.mockResolvedValue(null);
      mockProfileRepo.findById.mockResolvedValue(null);
      const mockCreated = { id: 'j-2', trainNumber: '99999' };
      mockJourneyRepo.create.mockResolvedValue(mockCreated);

      const result = await service.createJourney('u-1', {
        trainNumber: '99999',
        trainName: 'Custom Summer Spl',
        travelDate: '2026-09-20',
        userName: 'Custom Name',
        isTrainVerified: false,
      });

      expect(result).toEqual(mockCreated);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockUnverifiedRepo.create).toHaveBeenCalledWith(
        {
          trainNumber: '99999',
          trainName: 'Custom Summer Spl',
          submittedBy: 'u-1',
          enteredValue: '99999',
          normalizedValue: '99999',
        },
        mockPrisma,
      );
      expect(mockJourneyRepo.create).toHaveBeenCalledWith(
        {
          userId: 'u-1',
          userName: 'Custom Name',
          trainNumber: '99999',
          trainName: 'Custom Summer Spl',
          travelDate: new Date('2026-09-20T00:00:00.000Z'),
          coach: null,
          boardingStation: null,
          destinationStation: null,
          college: null,
          gender: null,
        },
        mockPrisma,
      );
    });
  });

  describe('deleteJourney', () => {
    it('deletes own journey successfully', async () => {
      mockJourneyRepo.deleteByIdAndUser.mockResolvedValue(true);
      await expect(service.deleteJourney('j-1', 'u-1')).resolves.toBeUndefined();
      expect(mockJourneyRepo.deleteByIdAndUser).toHaveBeenCalledWith('j-1', 'u-1');
    });

    it('throws notFound when journey does not exist or belongs to another user', async () => {
      mockJourneyRepo.deleteByIdAndUser.mockResolvedValue(false);
      await expect(service.deleteJourney('j-other', 'u-1')).rejects.toThrow(AppError);
    });
  });

  describe('findCompanions', () => {
    it('throws badRequest on invalid date', async () => {
      await expect(service.findCompanions('u-1', '12301', 'bad-date')).rejects.toThrow(AppError);
    });

    it('finds companions filtering symmetrically blocked users', async () => {
      mockAccessService.getSymmetricBlockedUserIds.mockResolvedValue(
        new Set(['u-blocked-1', 'u-blocked-2']),
      );
      const mockCompanions = [{ id: 'j-comp', userId: 'u-2', trainNumber: '12301' }];
      mockJourneyRepo.findCompanions.mockResolvedValue(mockCompanions);

      const result = await service.findCompanions('u-1', '12301', '2026-09-15');
      expect(result).toEqual(mockCompanions);
      expect(mockAccessService.getSymmetricBlockedUserIds).toHaveBeenCalledWith('u-1');
      expect(mockJourneyRepo.findCompanions).toHaveBeenCalledWith(
        'u-1',
        '12301',
        new Date('2026-09-15T00:00:00.000Z'),
        ['u-blocked-1', 'u-blocked-2'],
      );
    });
  });
});
