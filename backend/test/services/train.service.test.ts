import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrainService } from '../../src/services/train.service.js';
import type { TrainRepository } from '../../src/repositories/trains.repo.js';
import type { UnverifiedTrainRepository } from '../../src/repositories/unverified-trains.repo.js';

describe('TrainService (Unit)', () => {
  let service: TrainService;
  let mockTrainRepo: {
    search: ReturnType<typeof vi.fn>;
    findByNumber: ReturnType<typeof vi.fn>;
  };
  let mockUnverifiedRepo: {
    create: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockTrainRepo = {
      search: vi.fn(),
      findByNumber: vi.fn(),
    };
    mockUnverifiedRepo = {
      create: vi.fn(),
    };
    service = new TrainService({
      trainRepo: mockTrainRepo as unknown as TrainRepository,
      unverifiedRepo: mockUnverifiedRepo as unknown as UnverifiedTrainRepository,
    });
  });

  describe('search', () => {
    it('returns empty array when query is less than 2 characters', async () => {
      expect(await service.search('')).toEqual([]);
      expect(await service.search('a')).toEqual([]);
      expect(await service.search('  a ')).toEqual([]);
      expect(mockTrainRepo.search).not.toHaveBeenCalled();
    });

    it('delegates to TrainRepository when query >= 2 characters', async () => {
      const mockResults = [{ trainNumber: '12301', trainName: 'Rajdhani' }];
      mockTrainRepo.search.mockResolvedValue(mockResults);

      const result = await service.search('123', 10);
      expect(result).toEqual(mockResults);
      expect(mockTrainRepo.search).toHaveBeenCalledWith('123', 10);
    });
  });

  describe('logUnverifiedTrain', () => {
    it('creates unverified train entry with normalized values', async () => {
      const mockCreated = { id: 'uv-1', trainNumber: '99999' };
      mockUnverifiedRepo.create.mockResolvedValue(mockCreated);

      const result = await service.logUnverifiedTrain({
        trainNumber: '  99999  ',
        trainName: '  Special Train  ',
        submittedBy: 'u-1',
      });

      expect(result).toEqual(mockCreated);
      expect(mockUnverifiedRepo.create).toHaveBeenCalledWith({
        trainNumber: '99999',
        trainName: 'Special Train',
        submittedBy: 'u-1',
        enteredValue: '99999',
        normalizedValue: '99999',
      });
    });
  });
});
