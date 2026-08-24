import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, PrismaClient } from '@prisma/client';
import { MessageRepository } from '../../src/repositories/messages.repo.js';

describe('MessageRepository (Unit)', () => {
  let mockPrisma: {
    message: {
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let repo: MessageRepository;

  const mockMsg: Message = {
    id: 'm1111111-1111-4111-8111-111111111111',
    conversationId: 'c1111111-1111-4111-8111-111111111111',
    senderId: '00000000-0000-4000-8000-000000000001',
    senderName: 'Alex',
    text: 'Hello!',
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    attachmentSize: null,
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockPrisma = {
      message: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
    };
    repo = new MessageRepository(mockPrisma as unknown as PrismaClient);
  });

  describe('findById', () => {
    it('queries message by primary key ID', async () => {
      mockPrisma.message.findUnique.mockResolvedValue(mockMsg);

      const result = await repo.findById(mockMsg.id);

      expect(mockPrisma.message.findUnique).toHaveBeenCalledWith({
        where: { id: mockMsg.id },
      });
      expect(result).toEqual(mockMsg);
    });
  });

  describe('findByConversationId', () => {
    it('queries messages in conversation ordered by createdAt ASC', async () => {
      mockPrisma.message.findMany.mockResolvedValue([mockMsg]);

      const result = await repo.findByConversationId(mockMsg.conversationId, 50);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
        where: { conversationId: mockMsg.conversationId },
        orderBy: [{ createdAt: 'asc' }],
        take: 50,
      });
      expect(result).toEqual([mockMsg]);
    });

    it('applies before cursor pagination filter', async () => {
      mockPrisma.message.findMany.mockResolvedValue([]);
      const beforeDate = new Date('2026-08-24T15:00:00.000Z');

      await repo.findByConversationId(mockMsg.conversationId, 50, beforeDate);

      expect(mockPrisma.message.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: mockMsg.conversationId,
          createdAt: { lt: beforeDate },
        },
        orderBy: [{ createdAt: 'asc' }],
        take: 50,
      });
    });
  });

  describe('countUnreadMessages', () => {
    it('counts unread messages when lastReadTimestamp is null (all messages by other sender)', async () => {
      mockPrisma.message.count.mockResolvedValue(3);

      const count = await repo.countUnreadMessages(mockMsg.conversationId, 'user-me', null);

      expect(mockPrisma.message.count).toHaveBeenCalledWith({
        where: {
          conversationId: mockMsg.conversationId,
          senderId: { not: 'user-me' },
        },
      });
      expect(count).toBe(3);
    });

    it('counts unread messages created after lastReadTimestamp', async () => {
      mockPrisma.message.count.mockResolvedValue(2);
      const lastReadTs = new Date('2026-08-24T11:00:00.000Z');

      const count = await repo.countUnreadMessages(mockMsg.conversationId, 'user-me', lastReadTs);

      expect(mockPrisma.message.count).toHaveBeenCalledWith({
        where: {
          conversationId: mockMsg.conversationId,
          senderId: { not: 'user-me' },
          createdAt: { gt: lastReadTs },
        },
      });
      expect(count).toBe(2);
    });
  });

  describe('createInTx', () => {
    it('creates message with given transaction client', async () => {
      const mockTx = {
        message: {
          create: vi.fn().mockResolvedValue(mockMsg),
        },
      };

      const result = await repo.createInTx(
        {
          conversationId: mockMsg.conversationId,
          senderId: mockMsg.senderId,
          senderName: mockMsg.senderName,
          text: mockMsg.text,
        },
        mockTx as unknown as Parameters<typeof repo.createInTx>[1],
      );

      expect(mockTx.message.create).toHaveBeenCalledWith({
        data: {
          conversationId: mockMsg.conversationId,
          senderId: mockMsg.senderId,
          senderName: mockMsg.senderName,
          text: mockMsg.text,
          attachmentUrl: null,
          attachmentType: null,
          attachmentName: null,
          attachmentSize: null,
        },
      });
      expect(result).toEqual(mockMsg);
    });
  });
});
