import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import { UnverifiedTrainRepository } from '../../src/repositories/unverified-trains.repo.js';

describe('UnverifiedTrainRepository (Unit)', () => {
  let repo: UnverifiedTrainRepository;
  let mockPrisma: {
    unverifiedTrain: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      unverifiedTrain: {
        findUnique: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
    };
    repo = new UnverifiedTrainRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findById', () => {
    it('finds unverified train by primary key', async () => {
      const mockEntry = { id: 'uv-1', trainNumber: '99999' };
      mockPrisma.unverifiedTrain.findUnique.mockResolvedValue(mockEntry);

      const result = await repo.findById('uv-1');
      expect(result).toEqual(mockEntry);
      expect(mockPrisma.unverifiedTrain.findUnique).toHaveBeenCalledWith({
        where: { id: 'uv-1' },
      });
    });
  });

  describe('create', () => {
    it('creates an unverified train row', async () => {
      const data = {
        trainNumber: '99999',
        trainName: 'Summer Spl',
        submittedBy: 'u-1',
        enteredValue: '99999',
        normalizedValue: '99999',
      };
      const mockCreated = { id: 'uv-1', ...data };
      mockPrisma.unverifiedTrain.create.mockResolvedValue(mockCreated);

      const result = await repo.create(data);
      expect(result).toEqual(mockCreated);
      expect(mockPrisma.unverifiedTrain.create).toHaveBeenCalledWith({
        data: {
          trainNumber: '99999',
          trainName: 'Summer Spl',
          submittedBy: 'u-1',
          enteredValue: '99999',
          normalizedValue: '99999',
        },
      });
    });

    it('uses transactional client when provided', async () => {
      const txMock = {
        unverifiedTrain: {
          create: vi.fn().mockResolvedValue({ id: 'uv-tx' }),
        },
      };
      const data = { trainNumber: '88888' };
      const result = await repo.create(data, txMock as unknown as Prisma.TransactionClient);
      expect(result).toEqual({ id: 'uv-tx' });
      expect(txMock.unverifiedTrain.create).toHaveBeenCalled();
      expect(mockPrisma.unverifiedTrain.create).not.toHaveBeenCalled();
    });
  });

  describe('findBySubmittedBy', () => {
    it('returns entries submitted by user', async () => {
      const mockEntries = [{ id: 'uv-1', submittedBy: 'u-1' }];
      mockPrisma.unverifiedTrain.findMany.mockResolvedValue(mockEntries);

      const result = await repo.findBySubmittedBy('u-1');
      expect(result).toEqual(mockEntries);
      expect(mockPrisma.unverifiedTrain.findMany).toHaveBeenCalledWith({
        where: { submittedBy: 'u-1' },
        orderBy: [{ createdAt: 'desc' }],
      });
    });
  });
});
