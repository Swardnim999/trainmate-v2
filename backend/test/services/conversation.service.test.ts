import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Conversation } from '@prisma/client';
import { ConversationService } from '../../src/services/conversation.service.js';
import type { ConversationRepository } from '../../src/repositories/conversations.repo.js';
import type { ProfileRepository } from '../../src/repositories/profiles.repo.js';
import type { AccessService } from '../../src/services/access.service.js';
import { AppError, NotFoundError } from '../../src/utils/errors.js';

describe('ConversationService (Unit)', () => {
  let mockConversationsRepo: {
    findById: ReturnType<typeof vi.fn>;
    findUserConversations: ReturnType<typeof vi.fn>;
    findExistingBetween: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    softDeleteForUser: ReturnType<typeof vi.fn>;
  };
  let mockProfilesRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockAccess: {
    isBlocked: ReturnType<typeof vi.fn>;
    hasAcceptedRequest: ReturnType<typeof vi.fn>;
  };
  let service: ConversationService;

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const user3 = '00000000-0000-4000-8000-000000000003';

  const mockConv: Conversation = {
    id: 'c1111111-1111-4111-8111-111111111111',
    participants: [user1, user2],
    participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: '',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  beforeEach(() => {
    mockConversationsRepo = {
      findById: vi.fn(),
      findUserConversations: vi.fn(),
      findExistingBetween: vi.fn(),
      create: vi.fn(),
      softDeleteForUser: vi.fn(),
    };
    mockProfilesRepo = {
      findById: vi.fn(),
    };
    mockAccess = {
      isBlocked: vi.fn().mockResolvedValue(false),
      hasAcceptedRequest: vi.fn().mockResolvedValue(true),
    };

    service = new ConversationService({
      conversations: mockConversationsRepo as unknown as ConversationRepository,
      profiles: mockProfilesRepo as unknown as ProfileRepository,
      access: mockAccess as unknown as AccessService,
    });
  });

  describe('listConversations', () => {
    it('returns active conversations for caller', async () => {
      mockConversationsRepo.findUserConversations.mockResolvedValue([mockConv]);

      const result = await service.listConversations(user1);

      expect(mockConversationsRepo.findUserConversations).toHaveBeenCalledWith(user1);
      expect(result).toEqual([mockConv]);
    });
  });

  describe('getConversation', () => {
    it('returns conversation if caller is a participant', async () => {
      mockConversationsRepo.findById.mockResolvedValue(mockConv);

      const result = await service.getConversation(user1, mockConv.id);

      expect(mockConversationsRepo.findById).toHaveBeenCalledWith(mockConv.id);
      expect(result).toEqual(mockConv);
    });

    it('throws 404 if conversation not found or caller is not participant', async () => {
      mockConversationsRepo.findById.mockResolvedValue(mockConv);

      await expect(service.getConversation(user3, mockConv.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('createConversation', () => {
    it('creates a new conversation when accepted request exists and not blocked', async () => {
      mockConversationsRepo.findExistingBetween.mockResolvedValue(null);
      mockConversationsRepo.create.mockResolvedValue(mockConv);

      const result = await service.createConversation(user1, {
        participants: [user1, user2],
        participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
        trainNumber: '12951',
        travelDate: '2026-09-15',
      });

      expect(mockAccess.isBlocked).toHaveBeenCalledWith(user1, user2);
      expect(mockAccess.hasAcceptedRequest).toHaveBeenCalledWith(user1, user2);
      expect(mockConversationsRepo.create).toHaveBeenCalled();
      expect(result).toEqual(mockConv);
    });

    it('returns existing conversation idempotently if already present', async () => {
      mockConversationsRepo.findExistingBetween.mockResolvedValue(mockConv);

      const result = await service.createConversation(user1, {
        participants: [user1, user2],
        trainNumber: '12951',
        travelDate: '2026-09-15',
      });

      expect(mockConversationsRepo.findExistingBetween).toHaveBeenCalledWith(
        user1,
        user2,
        '12951',
        expect.any(Date),
      );
      expect(mockConversationsRepo.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockConv);
    });

    it('rejects if caller is not included in participants', async () => {
      await expect(
        service.createConversation(user3, {
          participants: [user1, user2],
        }),
      ).rejects.toThrow(AppError);
    });

    it('rejects if users are blocked', async () => {
      mockAccess.isBlocked.mockResolvedValue(true);

      await expect(
        service.createConversation(user1, {
          participants: [user1, user2],
        }),
      ).rejects.toThrow('Cannot create conversation with this user');
    });

    it('rejects with 403 if no accepted companion request exists', async () => {
      mockAccess.hasAcceptedRequest.mockResolvedValue(false);

      await expect(
        service.createConversation(user1, {
          participants: [user1, user2],
        }),
      ).rejects.toThrow('Conversation creation requires an accepted companion request');
    });
  });

  describe('softDeleteForUser', () => {
    it('appends user to deleted_for if caller is participant', async () => {
      mockConversationsRepo.findById.mockResolvedValue(mockConv);
      mockConversationsRepo.softDeleteForUser.mockResolvedValue(true);

      await expect(service.softDeleteForUser(user1, mockConv.id)).resolves.toBeUndefined();
      expect(mockConversationsRepo.softDeleteForUser).toHaveBeenCalledWith(mockConv.id, user1);
    });

    it('throws 404 if caller is not a participant (existence masking)', async () => {
      mockConversationsRepo.findById.mockResolvedValue(mockConv);

      await expect(service.softDeleteForUser(user3, mockConv.id)).rejects.toThrow(NotFoundError);
    });
  });
});
