import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerRoomHandlers } from '../../src/sockets/handlers/rooms.handler.js';
import type { AuthenticatedSocket } from '../../src/sockets/middleware/socket-auth.js';
import type { ConversationRepository } from '../../src/repositories/conversations.repo.js';
import type { PresenceCoordinator } from '../../src/sockets/presence.js';
import type { Conversation } from '@prisma/client';

describe('Rooms Handler (Unit)', () => {
  let mockSocket: {
    user: { id: string; email: string };
    join: ReturnType<typeof vi.fn>;
    leave: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockConversationsRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let mockPresence: {
    handleJoin: ReturnType<typeof vi.fn>;
    handleLeave: ReturnType<typeof vi.fn>;
  };

  const convId = 'c1111111-1111-4111-8111-111111111111';
  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const stranger = '00000000-0000-4000-8000-000000000099';

  const mockConv: Conversation = {
    id: convId,
    participants: [user1, user2],
    participantNames: { [user1]: 'Alex', [user2]: 'Bob' },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: '',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  const listeners: Record<string, (...args: unknown[]) => unknown> = {};

  beforeEach(() => {
    mockSocket = {
      user: { id: user1, email: 'alex@example.com' },
      join: vi.fn(),
      leave: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };
    mockConversationsRepo = {
      findById: vi.fn().mockResolvedValue(mockConv),
    };
    mockPresence = {
      handleJoin: vi.fn(),
      handleLeave: vi.fn(),
    };

    registerRoomHandlers(
      mockSocket as unknown as AuthenticatedSocket,
      mockConversationsRepo as unknown as ConversationRepository,
      mockPresence as unknown as PresenceCoordinator,
    );
  });

  it('authorizes participant and joins room on join:conversation', async () => {
    const callback = vi.fn();
    await listeners['join:conversation']({ conversationId: convId }, callback);

    expect(mockConversationsRepo.findById).toHaveBeenCalledWith(convId);
    expect(mockSocket.join).toHaveBeenCalledWith(`conv:${convId}`);
    expect(mockPresence.handleJoin).toHaveBeenCalledWith(mockSocket, convId);
    expect(callback).toHaveBeenCalledWith({ success: true });
  });

  it('rejects join when conversation does not exist or caller is not participant (404)', async () => {
    mockSocket.user.id = stranger;
    const callback = vi.fn();
    await listeners['join:conversation']({ conversationId: convId }, callback);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'NOT_FOUND',
      message: 'Conversation not found',
    });
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'Conversation not found' }),
    );
  });

  it('rejects invalid conversation ID format', async () => {
    const callback = vi.fn();
    await listeners['join:conversation']({ conversationId: 'not-a-uuid' }, callback);

    expect(mockSocket.join).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('error', {
      code: 'VALIDATION_ERROR',
      message: 'Invalid conversation ID',
    });
  });

  it('leaves room on leave:conversation', async () => {
    const callback = vi.fn();
    await listeners['leave:conversation']({ conversationId: convId }, callback);

    expect(mockSocket.leave).toHaveBeenCalledWith(`conv:${convId}`);
    expect(mockPresence.handleLeave).toHaveBeenCalledWith(mockSocket, convId);
    expect(callback).toHaveBeenCalledWith({ success: true });
  });
});
