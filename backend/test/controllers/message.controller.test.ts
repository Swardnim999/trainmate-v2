import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Message, LastRead } from '@prisma/client';
import { MessageController } from '../../src/controllers/message.controller.js';
import type { MessageService } from '../../src/services/message.service.js';

describe('MessageController (Unit)', () => {
  let mockService: {
    listMessages: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
    getLastRead: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
  };
  let controller: MessageController;
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const convId = 'c1111111-1111-4111-8111-111111111111';

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
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  const mockLastRead: LastRead = {
    id: 'lr-1',
    userId: user1,
    conversationId: convId,
    timestamp: new Date('2026-08-24T12:00:00.000Z'),
  };

  beforeEach(() => {
    mockService = {
      listMessages: vi.fn(),
      sendMessage: vi.fn(),
      getUnreadCount: vi.fn(),
      getLastRead: vi.fn(),
      markAsRead: vi.fn(),
    };
    controller = new MessageController({
      messageService: mockService as unknown as MessageService,
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

  it('listMessages returns 200 with serialized messages list', async () => {
    mockService.listMessages.mockResolvedValue([mockMsg]);
    mockReq.validated = {
      params: { id: convId },
      query: { limit: 50 },
    };

    await controller.listMessages(mockReq as Request, mockRes as Response);

    expect(mockService.listMessages).toHaveBeenCalledWith(user1, convId, 50, undefined);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith([
      expect.objectContaining({ id: mockMsg.id, text: 'Hello!' }),
    ]);
  });

  it('sendMessage returns 201 with created message', async () => {
    mockService.sendMessage.mockResolvedValue(mockMsg);
    mockReq.validated = {
      params: { id: convId },
      body: { text: 'Hello!' },
    };

    await controller.sendMessage(mockReq as Request, mockRes as Response);

    expect(mockService.sendMessage).toHaveBeenCalledWith(user1, convId, { text: 'Hello!' });
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });

  it('getUnreadCount returns 200 with unread count', async () => {
    mockService.getUnreadCount.mockResolvedValue(4);
    mockReq.validated = {
      params: { id: convId },
    };

    await controller.getUnreadCount(mockReq as Request, mockRes as Response);

    expect(mockService.getUnreadCount).toHaveBeenCalledWith(user1, convId);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ count: 4 });
  });

  it('getLastRead returns 200 with last read timestamp', async () => {
    mockService.getLastRead.mockResolvedValue(mockLastRead);
    mockReq.validated = {
      params: { id: convId, userId: user2 },
    };

    await controller.getLastRead(mockReq as Request, mockRes as Response);

    expect(mockService.getLastRead).toHaveBeenCalledWith(user1, convId, user2);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ timestamp: '2026-08-24T12:00:00.000Z' });
  });

  it('markAsRead returns 200 with upserted timestamp', async () => {
    mockService.markAsRead.mockResolvedValue(mockLastRead);
    mockReq.validated = {
      params: { id: convId },
    };

    await controller.markAsRead(mockReq as Request, mockRes as Response);

    expect(mockService.markAsRead).toHaveBeenCalledWith(user1, convId);
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ timestamp: '2026-08-24T12:00:00.000Z' });
  });
});
