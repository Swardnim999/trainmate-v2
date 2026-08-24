import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { TrainRepository } from '../../src/repositories/trains.repo.js';

describe('TrainRepository (Unit)', () => {
  let repo: TrainRepository;
  let mockPrisma: {
    train: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      train: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
    };
    repo = new TrainRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findByNumber', () => {
    it('finds train by primary key', async () => {
      const mockTrain = { trainNumber: '12301', trainName: 'Rajdhani', active: true };
      mockPrisma.train.findUnique.mockResolvedValue(mockTrain);

      const result = await repo.findByNumber('12301');
      expect(result).toEqual(mockTrain);
      expect(mockPrisma.train.findUnique).toHaveBeenCalledWith({
        where: { trainNumber: '12301' },
      });
    });
  });

  describe('search', () => {
    it('returns empty array when query is blank', async () => {
      const result = await repo.search('   ');
      expect(result).toEqual([]);
      expect(mockPrisma.train.findMany).not.toHaveBeenCalled();
    });

    it('searches active trains by number or name with default limit 15', async () => {
      const mockResults = [{ trainNumber: '12301', trainName: 'Rajdhani Express' }];
      mockPrisma.train.findMany.mockResolvedValue(mockResults);

      const result = await repo.search('raj');
      expect(result).toEqual(mockResults);
      expect(mockPrisma.train.findMany).toHaveBeenCalledWith({
        where: {
          active: true,
          OR: [
            { trainNumber: { contains: 'raj', mode: 'insensitive' } },
            { trainName: { contains: 'raj', mode: 'insensitive' } },
          ],
        },
        orderBy: [{ trainNumber: 'asc' }],
        take: 15,
      });
    });
  });

  describe('upsert', () => {
    it('upserts a train record', async () => {
      const mockTrain = { trainNumber: '12301', trainName: 'Rajdhani', active: true };
      mockPrisma.train.upsert.mockResolvedValue(mockTrain);

      const result = await repo.upsert('12301', 'Rajdhani', true);
      expect(result).toEqual(mockTrain);
      expect(mockPrisma.train.upsert).toHaveBeenCalledWith({
        where: { trainNumber: '12301' },
        create: { trainNumber: '12301', trainName: 'Rajdhani', active: true },
        update: { trainName: 'Rajdhani', active: true },
      });
    });
  });
});
