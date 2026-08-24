import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import { RealtimeBroadcaster } from '../../src/sockets/broadcaster.js';
import type { SerializedMessage } from '../../src/serializers/message.serializer.js';
import type { SerializedConversation } from '../../src/serializers/conversation.serializer.js';

describe('RealtimeBroadcaster (Unit)', () => {
  let mockIo: {
    to: ReturnType<typeof vi.fn>;
  };
  let mockRoomEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };
  let broadcaster: RealtimeBroadcaster;

  beforeEach(() => {
    mockRoomEmitter = {
      emit: vi.fn(),
    };
    mockIo = {
      to: vi.fn().mockReturnValue(mockRoomEmitter),
    };
    broadcaster = new RealtimeBroadcaster(mockIo as unknown as SocketIOServer);
  });

  it('broadcastNewMessage emits message:new to conv:<conversationId> room', () => {
    const message: SerializedMessage = {
      id: 'm1',
      conversationId: 'c1',
      conversation_id: 'c1',
      senderId: 'u1',
      sender_id: 'u1',
      senderName: 'Alex',
      sender_name: 'Alex',
      text: 'Hello!',
      attachmentUrl: null,
      attachment_url: null,
      attachmentType: null,
      attachment_type: null,
      attachmentName: null,
      attachment_name: null,
      attachmentSize: null,
      attachment_size: null,
      createdAt: '2026-08-24T12:00:00.000Z',
      created_at: '2026-08-24T12:00:00.000Z',
    };

    broadcaster.broadcastNewMessage('c1', message);

    expect(mockIo.to).toHaveBeenCalledWith('conv:c1');
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith('message:new', message);
  });

  it('broadcastLastRead emits last-read:update to conv:<conversationId> room with dual keys', () => {
    broadcaster.broadcastLastRead('c1', 'u1', {
      timestamp: '2026-08-24T12:05:00.000Z',
    });

    expect(mockIo.to).toHaveBeenCalledWith('conv:c1');
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith('last-read:update', {
      userId: 'u1',
      user_id: 'u1',
      conversationId: 'c1',
      conversation_id: 'c1',
      timestamp: '2026-08-24T12:05:00.000Z',
    });
  });

  it('broadcastConversationUpdated emits conversation:updated to each participant user room', () => {
    const conv: SerializedConversation = {
      id: 'c1',
      participants: ['u1', 'u2'],
      participantNames: { u1: 'Alex', u2: 'Bob' },
      participant_names: { u1: 'Alex', u2: 'Bob' },
      trainNumber: '12951',
      train_number: '12951',
      travelDate: '2026-09-15',
      travel_date: '2026-09-15',
      lastMessage: 'Hello!',
      last_message: 'Hello!',
      lastMessageTime: '2026-08-24T12:00:00.000Z',
      last_message_time: '2026-08-24T12:00:00.000Z',
      deletedFor: [],
      deleted_for: [],
      createdAt: '2026-08-24T10:00:00.000Z',
      created_at: '2026-08-24T10:00:00.000Z',
    };

    broadcaster.broadcastConversationUpdated(['u1', 'u2'], conv);

    expect(mockIo.to).toHaveBeenCalledWith('user:u1');
    expect(mockIo.to).toHaveBeenCalledWith('user:u2');
    expect(mockRoomEmitter.emit).toHaveBeenCalledTimes(2);
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith('conversation:updated', conv);
  });
});
