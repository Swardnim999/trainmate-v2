import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { JourneyRepository } from '../../src/repositories/journeys.repo.js';

describe('JourneyRepository (Unit)', () => {
  let repo: JourneyRepository;
  let mockPrisma: {
    journey: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    $queryRaw: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPrisma = {
      journey: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      $queryRaw: vi.fn(),
    };
    repo = new JourneyRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findById', () => {
    it('finds journey by ID', async () => {
      const mockJourney = { id: 'j-1', userId: 'u-1', trainNumber: '12301' };
      mockPrisma.journey.findUnique.mockResolvedValue(mockJourney);

      const result = await repo.findById('j-1');
      expect(result).toEqual(mockJourney);
      expect(mockPrisma.journey.findUnique).toHaveBeenCalledWith({ where: { id: 'j-1' } });
    });

    it('returns null when not found', async () => {
      mockPrisma.journey.findUnique.mockResolvedValue(null);
      const result = await repo.findById('j-missing');
      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('returns user journeys ordered by travel_date asc', async () => {
      const mockJourneys = [
        { id: 'j-1', travelDate: new Date('2026-09-01') },
        { id: 'j-2', travelDate: new Date('2026-09-10') },
      ];
      mockPrisma.journey.findMany.mockResolvedValue(mockJourneys);

      const result = await repo.findByUserId('u-1');
      expect(result).toEqual(mockJourneys);
      expect(mockPrisma.journey.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        orderBy: [{ travelDate: 'asc' }, { createdAt: 'asc' }],
      });
    });
  });

  describe('create', () => {
    it('creates a new journey record with null defaults', async () => {
      const date = new Date('2026-09-15');
      const createData = {
        userId: 'u-1',
        trainNumber: '12301',
        travelDate: date,
      };
      const mockCreated = { id: 'j-1', ...createData, userName: null, coach: null };
      mockPrisma.journey.create.mockResolvedValue(mockCreated);

      const result = await repo.create(createData);
      expect(result).toEqual(mockCreated);
      expect(mockPrisma.journey.create).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          userName: null,
          trainNumber: '12301',
          trainName: null,
          travelDate: date,
          coach: null,
          boardingStation: null,
          destinationStation: null,
          college: null,
          gender: null,
        },
      });
    });
  });

  describe('deleteByIdAndUser', () => {
    it('returns true when a journey is deleted', async () => {
      mockPrisma.journey.deleteMany.mockResolvedValue({ count: 1 });
      const result = await repo.deleteByIdAndUser('j-1', 'u-1');
      expect(result).toBe(true);
      expect(mockPrisma.journey.deleteMany).toHaveBeenCalledWith({
        where: { id: 'j-1', userId: 'u-1' },
      });
    });

    it('returns false when no journey matched id and userId', async () => {
      mockPrisma.journey.deleteMany.mockResolvedValue({ count: 0 });
      const result = await repo.deleteByIdAndUser('j-other', 'u-1');
      expect(result).toBe(false);
    });
  });

  describe('findCompanions', () => {
    it('queries companions excluding self and blocked user IDs', async () => {
      const date = new Date('2026-09-15');
      const mockMatches = [{ id: 'j-2', userId: 'u-2', trainNumber: '12301' }];
      mockPrisma.journey.findMany.mockResolvedValue(mockMatches);

      const result = await repo.findCompanions('u-1', '12301', date, ['u-blocked']);
      expect(result).toEqual(mockMatches);
      expect(mockPrisma.journey.findMany).toHaveBeenCalledWith({
        where: {
          trainNumber: '12301',
          travelDate: date,
          userId: {
            notIn: ['u-1', 'u-blocked'],
          },
        },
        orderBy: [{ createdAt: 'asc' }],
      });
    });
  });

  describe('hasJourneyOnTrainAndDate', () => {
    it('returns true when count > 0', async () => {
      mockPrisma.journey.count.mockResolvedValue(1);
      const date = new Date('2026-09-15');
      const result = await repo.hasJourneyOnTrainAndDate('u-1', '12301', date);
      expect(result).toBe(true);
    });

    it('returns false when count is 0', async () => {
      mockPrisma.journey.count.mockResolvedValue(0);
      const date = new Date('2026-09-15');
      const result = await repo.hasJourneyOnTrainAndDate('u-1', '12301', date);
      expect(result).toBe(false);
    });
  });

  describe('hasSharedJourney', () => {
    it('returns false when userA === userB', async () => {
      const result = await repo.hasSharedJourney('u-1', 'u-1');
      expect(result).toBe(false);
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('returns true when raw query returns exists = true', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ exists: true }]);
      const result = await repo.hasSharedJourney('u-1', 'u-2');
      expect(result).toBe(true);
    });

    it('returns false when raw query returns exists = false', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ exists: false }]);
      const result = await repo.hasSharedJourney('u-1', 'u-2');
      expect(result).toBe(false);
    });
  });

  describe('usersShareSpecificJourney', () => {
    it('returns false when userA === userB', async () => {
      const result = await repo.usersShareSpecificJourney('u-1', 'u-1', '12301', new Date());
      expect(result).toBe(false);
    });

    it('returns true when both users have journey on train and date', async () => {
      mockPrisma.journey.count.mockResolvedValue(1);
      const date = new Date('2026-09-15');
      const result = await repo.usersShareSpecificJourney('u-1', 'u-2', '12301', date);
      expect(result).toBe(true);
    });

    it('returns false when only one user has journey', async () => {
      mockPrisma.journey.count.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      const date = new Date('2026-09-15');
      const result = await repo.usersShareSpecificJourney('u-1', 'u-2', '12301', date);
      expect(result).toBe(false);
    });
  });
});
