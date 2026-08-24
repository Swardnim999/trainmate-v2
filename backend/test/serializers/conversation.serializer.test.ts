import { describe, it, expect } from 'vitest';
import type { Conversation } from '@prisma/client';
import { ConversationSerializer } from '../../src/serializers/conversation.serializer.js';

describe('ConversationSerializer (Unit)', () => {
  const mockConv: Conversation = {
    id: 'c1111111-1111-4111-8111-111111111111',
    participants: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    participantNames: {
      '00000000-0000-4000-8000-000000000001': 'Alex',
      '00000000-0000-4000-8000-000000000002': 'Sam',
    },
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    lastMessage: 'Hello on train!',
    lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
    deletedFor: [],
    createdAt: new Date('2026-08-24T10:00:00.000Z'),
  };

  it('serializes conversation with dual camelCase and snake_case properties', () => {
    const serialized = ConversationSerializer.toResponse(mockConv);

    expect(serialized.id).toBe(mockConv.id);
    expect(serialized.participants).toEqual(mockConv.participants);
    expect(serialized.participantNames).toEqual(mockConv.participantNames);
    expect(serialized.participant_names).toEqual(mockConv.participantNames);
    expect(serialized.trainNumber).toBe('12951');
    expect(serialized.train_number).toBe('12951');
    expect(serialized.travelDate).toBe('2026-09-15');
    expect(serialized.travel_date).toBe('2026-09-15');
    expect(serialized.lastMessage).toBe('Hello on train!');
    expect(serialized.last_message).toBe('Hello on train!');
    expect(serialized.lastMessageTime).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.last_message_time).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.createdAt).toBe('2026-08-24T10:00:00.000Z');
    expect(serialized.created_at).toBe('2026-08-24T10:00:00.000Z');
  });

  it('strictly enforces email privacy (deleted_for omitted, no email leaked)', () => {
    const serialized = ConversationSerializer.toResponse(mockConv) as unknown as Record<
      string,
      unknown
    >;

    expect(serialized['deletedFor']).toBeUndefined();
    expect(serialized['deleted_for']).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('email');
  });

  it('serializes list of conversations', () => {
    const list = ConversationSerializer.toResponseList([mockConv]);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(mockConv.id);
  });
});
