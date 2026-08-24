import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, LastRead, Conversation } from '@prisma/client';
import { MessageService } from '../../src/services/message.service.js';
import type { MessageRepository } from '../../src/repositories/messages.repo.js';
import type { LastReadRepository } from '../../src/repositories/last-read.repo.js';
import type { ConversationRepository } from '../../src/repositories/conversations.repo.js';
import type { ProfileRepository } from '../../src/repositories/profiles.repo.js';
import { NotFoundError } from '../../src/utils/errors.js';
import type { PrismaClient } from '@prisma/client';

describe('MessageService (Unit)', () => {
  let mockMessagesRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByConversationId: ReturnType<typeof vi.fn>;
    countUnreadMessages: ReturnType<typeof vi.fn>;
    createInTx: ReturnType<typeof vi.fn>;
  };
  let mockLastReadRepo: {
    findByUserAndConversation: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  let mockConversationsRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockProfilesRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockAccess: {
    isBlocked: ReturnType<typeof vi.fn>;
  };
  let mockDb: {
    $transaction: ReturnType<typeof vi.fn>;
  };
  let service: MessageService;

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const user3 = '00000000-0000-4000-8000-000000000003';
  const convId = 'c1111111-1111-4111-8111-111111111111';

  const mockConv: Conversation = {
    id: convId,
    participants: [user1, user2],
    participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: '',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  const mockMsg: Message = {
    id: 'm1111111-1111-4111-8111-111111111111',
    conversationId: convId,
    senderId: user1,
    senderName: 'Alex',
    text: 'Hello!',
    attachmentUrl: null,
    attachmentType: null,
    attachmentName: null,
    attachmentSize: null,
    createdAt: new Date('2026-08-24T12:05:00.000Z'),
  };

  const mockLastRead: LastRead = {
    id: 'lr-1',
    userId: user1,
    conversationId: convId,
    timestamp: new Date('2026-08-24T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockMessagesRepo = {
      findById: vi.fn(),
      findByConversationId: vi.fn(),
      countUnreadMessages: vi.fn(),
      createInTx: vi.fn(),
    };
    mockLastReadRepo = {
      findByUserAndConversation: vi.fn(),
      upsert: vi.fn(),
    };
    mockConversationsRepo = {
      findById: vi.fn().mockResolvedValue(mockConv),
    };
    mockProfilesRepo = {
      findById: vi.fn().mockResolvedValue({ id: user1, name: 'Alex' }),
    };
    mockAccess = {
      isBlocked: vi.fn().mockResolvedValue(false),
    };
    mockDb = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          message: {
            create: mockMessagesRepo.createInTx,
          },
          conversation: {
            update: vi.fn().mockResolvedValue(mockConv),
          },
        };
        return callback(mockTx);
      }),
    };

    service = new MessageService({
      messages: mockMessagesRepo as unknown as MessageRepository,
      lastRead: mockLastReadRepo as unknown as LastReadRepository,
      conversations: mockConversationsRepo as unknown as ConversationRepository,
      profiles: mockProfilesRepo as unknown as ProfileRepository,
      access: mockAccess as unknown as AccessService,
      db: mockDb as unknown as PrismaClient,
    });
  });

  describe('listMessages', () => {
    it('returns messages if caller is participant', async () => {
      mockMessagesRepo.findByConversationId.mockResolvedValue([mockMsg]);

      const result = await service.listMessages(user1, convId);

      expect(mockConversationsRepo.findById).toHaveBeenCalledWith(convId);
      expect(mockMessagesRepo.findByConversationId).toHaveBeenCalledWith(convId, 100, undefined);
      expect(result).toEqual([mockMsg]);
    });

    it('throws 404 if caller is not a participant (existence masking)', async () => {
      await expect(service.listMessages(user3, convId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('sendMessage', () => {
    it('sends text message atomically and bumps conversation preview', async () => {
      mockMessagesRepo.createInTx.mockResolvedValue(mockMsg);

      const result = await service.sendMessage(user1, convId, {
        text: 'Hello!',
      });

      expect(mockAccess.isBlocked).toHaveBeenCalledWith(user1, user2);
      expect(mockDb.$transaction).toHaveBeenCalled();
      expect(result).toEqual(mockMsg);
    });

    it('rejects if conversation does not exist or caller not participant (404)', async () => {
      await expect(service.sendMessage(user3, convId, { text: 'Hello!' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('rejects if participants are blocked (400 USER_BLOCKED)', async () => {
      mockAccess.isBlocked.mockResolvedValue(true);

      await expect(service.sendMessage(user1, convId, { text: 'Hello!' })).rejects.toThrow(
        'Cannot send message to this user',
      );
    });
  });

  describe('getUnreadCount', () => {
    it('calculates unread message count based on caller last_read', async () => {
      mockLastReadRepo.findByUserAndConversation.mockResolvedValue(mockLastRead);
      mockMessagesRepo.countUnreadMessages.mockResolvedValue(3);

      const count = await service.getUnreadCount(user1, convId);

      expect(mockLastReadRepo.findByUserAndConversation).toHaveBeenCalledWith(user1, convId);
      expect(mockMessagesRepo.countUnreadMessages).toHaveBeenCalledWith(
        convId,
        user1,
        mockLastRead.timestamp,
      );
      expect(count).toBe(3);
    });
  });

  describe('getLastRead & markAsRead', () => {
    it('getLastRead returns last_read for participant', async () => {
      mockLastReadRepo.findByUserAndConversation.mockResolvedValue(mockLastRead);

      const result = await service.getLastRead(user1, convId, user2);

      expect(mockLastReadRepo.findByUserAndConversation).toHaveBeenCalledWith(user2, convId);
      expect(result).toEqual(mockLastRead);
    });

    it('markAsRead upserts caller last_read', async () => {
      mockLastReadRepo.upsert.mockResolvedValue(mockLastRead);

      const result = await service.markAsRead(user1, convId);

      expect(mockLastReadRepo.upsert).toHaveBeenCalledWith(user1, convId, expect.any(Date));
      expect(result).toEqual(mockLastRead);
    });
  });
});
