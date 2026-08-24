import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Conversation } from '@prisma/client';
import { ConversationController } from '../../src/controllers/conversation.controller.js';
import type { ConversationService } from '../../src/services/conversation.service.js';

describe('ConversationController (Unit)', () => {
  let mockService: {
    listConversations: ReturnType<typeof vi.fn>;
    getConversation: ReturnType<typeof vi.fn>;
    createConversation: ReturnType<typeof vi.fn>;
    softDeleteForUser: ReturnType<typeof vi.fn>;
  };
  let controller: ConversationController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';

  const mockConv: Conversation = {
    id: 'c1111111-1111-4111-8111-111111111111',
    participants: [user1, user2],
    participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: 'Hello!',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  beforeEach(() => {
    mockService = {
      listConversations: vi.fn(),
      getConversation: vi.fn(),
      createConversation: vi.fn(),
      softDeleteForUser: vi.fn(),
    };
    controller = new ConversationController({
      conversationService: mockService as unknown as ConversationService,
    });

    mockReq = {
      user: { id: user1, email: 'alex@example.com' },
      query: {},
      params: {},
      body: {},
      validated: {},
    };
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
  });

  it('getMyConversations returns 200 with serialized list', async () => {
    mockService.listConversations.mockResolvedValue([mockConv]);

    await controller.getMyConversations(mockReq as Request, mockRes as Response);

    expect(mockService.listConversations).toHaveBeenCalledWith(user1);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: mockConv.id, trainNumber: '12951' }),
    ]);
  });

  it('getConversationById returns 200 with single serialized conversation', async () => {
    mockService.getConversation.mockResolvedValue(mockConv);
    mockReq.validated = { params: { id: mockConv.id } };

    await controller.getConversationById(mockReq as Request, mockRes as Response);

    expect(mockService.getConversation).toHaveBeenCalledWith(user1, mockConv.id);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockConv.id, trainNumber: '12951' }),
    );
  });

  it('createConversation returns 201 with created conversation', async () => {
    const inputData = {
      participants: [user1, user2],
      participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
      trainNumber: '12951',
      travelDate: '2026-09-15',
    };
    mockService.createConversation.mockResolvedValue(mockConv);
    mockReq.validated = { body: inputData };

    await controller.createConversation(mockReq as Request, mockRes as Response);

    expect(mockService.createConversation).toHaveBeenCalledWith(user1, inputData);
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  it('softDeleteForMe returns 204 No Content', async () => {
    mockService.softDeleteForUser.mockResolvedValue(undefined);
    mockReq.validated = { params: { id: mockConv.id } };

    await controller.softDeleteForMe(mockReq as Request, mockRes as Response);

    expect(mockService.softDeleteForUser).toHaveBeenCalledWith(user1, mockConv.id);
    expect(mockRes.status).toHaveBeenCalledWith(204);
    expect(mockRes.send).toHaveBeenCalled();
  });
});
