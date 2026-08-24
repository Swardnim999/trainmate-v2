import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation, PrismaClient } from '@prisma/client';
import { ConversationRepository } from '../../src/repositories/conversations.repo.js';

describe('ConversationRepository (Unit)', () => {
  let mockPrisma: {
    conversation: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
  };
  let repo: ConversationRepository;

  const mockConv: Conversation = {
    id: 'c1111111-1111-4111-8111-111111111111',
    participants: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    participantNames: {
      '00000000-0000-4000-8000-000000000001': 'Alex',
      '00000000-0000-4000-8000-000000000002': 'Sam',
    },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: 'Hello!',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      conversation: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      $executeRaw: vi.fn(),
    };
    repo = new ConversationRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findById', () => {
    it('queries conversation by primary key ID', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(mockConv);

      const result = await repo.findById(mockConv.id);

      expect(mockPrisma.conversation.findUnique).toHaveBeenCalledWith({
        where: { id: mockConv.id },
      });
      expect(result).toEqual(mockConv);
    });

    it('returns null when conversation not found', async () => {
      mockPrisma.conversation.findUnique.mockResolvedValue(null);

      const result = await repo.findById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('findUserConversations', () => {
    it('queries active conversations excluding deleted_for', async () => {
      mockPrisma.conversation.findMany.mockResolvedValue([mockConv]);

      const result = await repo.findUserConversations('00000000-0000-4000-8000-000000000001');

      expect(mockPrisma.conversation.findMany).toHaveBeenCalledWith({
        where: {
          participants: {
            has: '00000000-0000-4000-8000-000000000001',
          },
          NOT: {
            deletedFor: {
              has: '00000000-0000-4000-8000-000000000001',
            },
          },
        },
        orderBy: [{ lastMessageTime: 'desc' }],
      });
      expect(result).toEqual([mockConv]);
    });
  });

  describe('findExistingBetween', () => {
    it('finds existing conversation matching participants and train/date', async () => {
      mockPrisma.conversation.findFirst.mockResolvedValue(mockConv);

      const result = await repo.findExistingBetween(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '12951',
        mockConv.travelDate,
      );

      expect(mockPrisma.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          participants: {
            hasEvery: [
              '00000000-0000-4000-8000-000000000001',
              '00000000-0000-4000-8000-000000000002',
            ],
          },
          trainNumber: '12951',
          travelDate: mockConv.travelDate,
        },
        orderBy: [{ createdAt: 'desc' }],
      });
      expect(result).toEqual(mockConv);
    });
  });

  describe('create', () => {
    it('creates a conversation with empty deleted_for array', async () => {
      mockPrisma.conversation.create.mockResolvedValue(mockConv);

      const result = await repo.create({
        participants: mockConv.participants,
        participantNames: mockConv.participantNames as Record<string, string>,
        trainNumber: mockConv.trainNumber,
        travelDate: mockConv.travelDate,
      });

      expect(mockPrisma.conversation.create).toHaveBeenCalledWith({
        data: {
          participants: mockConv.participants,
          participantNames: mockConv.participantNames,
          trainNumber: mockConv.trainNumber,
          travelDate: mockConv.travelDate,
          lastMessage: '',
          lastMessageTime: expect.any(Date),
          deletedFor: [],
        },
      });
      expect(result).toEqual(mockConv);
    });
  });

  describe('softDeleteForUser', () => {
    it('appends user to deleted_for when not already present', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);

      const result = await repo.softDeleteForUser(
        mockConv.id,
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result).toBe(true);
    });

    it('returns true if already present in deleted_for', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0);
      mockPrisma.conversation.findUnique.mockResolvedValue({
        ...mockConv,
        deletedFor: ['00000000-0000-4000-8000-000000000001'],
      });

      const result = await repo.softDeleteForUser(
        mockConv.id,
        '00000000-0000-4000-8000-000000000001',
      );

      expect(result).toBe(true);
    });

    it('returns false if conversation does not exist or user not a participant', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0);
      mockPrisma.conversation.findUnique.mockResolvedValue(null);

      const result = await repo.softDeleteForUser(mockConv.id, 'random-user');

      expect(result).toBe(false);
    });
  });

  describe('updateLastMessage', () => {
    it('updates last_message and last_message_time', async () => {
      mockPrisma.conversation.update.mockResolvedValue(mockConv);
      const newTime = new Date();

      await repo.updateLastMessage(mockConv.id, 'New preview message', newTime);

      expect(mockPrisma.conversation.update).toHaveBeenCalledWith({
        where: { id: mockConv.id },
        data: {
          lastMessage: 'New preview message',
          lastMessageTime: newTime,
        },
      });
    });
  });
});
