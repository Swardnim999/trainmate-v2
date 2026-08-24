import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LastRead, PrismaClient } from '@prisma/client';
import { LastReadRepository } from '../../src/repositories/last-read.repo.js';

describe('LastReadRepository (Unit)', () => {
  let mockPrisma: {
    lastRead: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  let repo: LastReadRepository;

  const mockLastRead: LastRead = {
    id: 'lr111111-1111-4111-8111-111111111111',
    userId: '00000000-0000-4000-8000-000000000001',
    conversationId: 'c1111111-1111-4111-8111-111111111111',
    timestamp: new Date('2026-08-24T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      lastRead: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    };
    repo = new LastReadRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findByUserAndConversation', () => {
    it('queries last_read by compound unique key', async () => {
      mockPrisma.lastRead.findUnique.mockResolvedValue(mockLastRead);

      const result = await repo.findByUserAndConversation(
        mockLastRead.userId,
        mockLastRead.conversationId,
      );

      expect(mockPrisma.lastRead.findUnique).toHaveBeenCalledWith({
        where: {
          userId_conversationId: {
            userId: mockLastRead.userId,
            conversationId: mockLastRead.conversationId,
          },
        },
      });
      expect(result).toEqual(mockLastRead);
    });
  });

  describe('upsert', () => {
    it('upserts last_read timestamp', async () => {
      mockPrisma.lastRead.upsert.mockResolvedValue(mockLastRead);
      const newTs = new Date('2026-08-24T12:30:00.000Z');

      const result = await repo.upsert(mockLastRead.userId, mockLastRead.conversationId, newTs);

      expect(mockPrisma.lastRead.upsert).toHaveBeenCalledWith({
        where: {
          userId_conversationId: {
            userId: mockLastRead.userId,
            conversationId: mockLastRead.conversationId,
          },
        },
        create: {
          userId: mockLastRead.userId,
          conversationId: mockLastRead.conversationId,
          timestamp: newTs,
        },
        update: {
          timestamp: newTs,
        },
      });
      expect(result).toEqual(mockLastRead);
    });
  });
});
