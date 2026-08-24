import { describe, it, expect } from 'vitest';
import type { Message, LastRead } from '@prisma/client';
import { MessageSerializer } from '../../src/serializers/message.serializer.js';

describe('MessageSerializer (Unit)', () => {
  const mockMsg: Message = {
    id: 'm1111111-1111-4111-8111-111111111111',
    conversationId: 'c1111111-1111-4111-8111-111111111111',
    senderId: '00000000-0000-4000-8000-000000000001',
    senderName: 'Alex',
    text: 'Hello!',
    attachmentUrl: 'https://example.com/photo.jpg',
    attachmentType: 'image/jpeg',
    attachmentName: 'photo.jpg',
    attachmentSize: BigInt(2048576),
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  it('serializes message with dual camelCase and snake_case properties', () => {
    const serialized = MessageSerializer.toResponse(mockMsg);

    expect(serialized.id).toBe(mockMsg.id);
    expect(serialized.conversationId).toBe(mockMsg.conversationId);
    expect(serialized.conversation_id).toBe(mockMsg.conversationId);
    expect(serialized.senderId).toBe(mockMsg.senderId);
    expect(serialized.sender_id).toBe(mockMsg.senderId);
    expect(serialized.senderName).toBe('Alex');
    expect(serialized.sender_name).toBe('Alex');
    expect(serialized.text).toBe('Hello!');
    expect(serialized.attachmentUrl).toBe('https://example.com/photo.jpg');
    expect(serialized.attachment_url).toBe('https://example.com/photo.jpg');
    expect(serialized.attachmentType).toBe('image/jpeg');
    expect(serialized.attachment_type).toBe('image/jpeg');
    expect(serialized.attachmentName).toBe('photo.jpg');
    expect(serialized.attachment_name).toBe('photo.jpg');
    expect(serialized.attachmentSize).toBe(2048576);
    expect(serialized.attachment_size).toBe(2048576);
    expect(serialized.createdAt).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.created_at).toBe('2026-08-24T12:00:00.000Z');
  });

  it('safely serializes BigInt to Number (no JSON.stringify crash)', () => {
    const serialized = MessageSerializer.toResponse(mockMsg);
    expect(typeof serialized.attachmentSize).toBe('number');
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('strictly enforces email privacy (no email fields exposed)', () => {
    const serialized = MessageSerializer.toResponse(mockMsg);
    expect(JSON.stringify(serialized)).not.toContain('email');
  });

  it('serializes list of messages', () => {
    const list = MessageSerializer.toResponseList([mockMsg]);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(mockMsg.id);
  });

  it('serializes last_read receipt and unread count', () => {
    const mockLastRead: LastRead = {
      id: 'lr-1',
      userId: 'u-1',
      conversationId: 'c-1',
      timestamp: new Date('2026-08-24T12:00:00.000Z'),
    };

    const lrRes = MessageSerializer.toLastReadResponse(mockLastRead);
    expect(lrRes.timestamp).toBe('2026-08-24T12:00:00.000Z');

    const lrNullRes = MessageSerializer.toLastReadResponse(null);
    expect(lrNullRes.timestamp).toBeNull();

    const countRes = MessageSerializer.toUnreadCountResponse(5);
    expect(countRes.count).toBe(5);
  });
});
