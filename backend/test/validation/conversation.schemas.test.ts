import { describe, it, expect } from 'vitest';
import {
  createConversationSchema,
  conversationIdParamSchema,
} from '../../src/validation/conversation.schemas.js';

describe('Conversation Validation Schemas (Unit)', () => {
  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';

  describe('createConversationSchema', () => {
    it('parses valid camelCase conversation payload', () => {
      const result = createConversationSchema.safeParse({
        participants: [user1, user2],
        participantNames: { [user1]: 'Alex', [user2]: 'Sam' },
        trainNumber: '12951',
        travelDate: '2026-09-15',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.participants).toEqual([user1, user2]);
        expect(result.data.participantNames).toEqual({ [user1]: 'Alex', [user2]: 'Sam' });
        expect(result.data.trainNumber).toBe('12951');
        expect(result.data.travelDate).toBe('2026-09-15');
      }
    });

    it('parses valid snake_case conversation payload', () => {
      const result = createConversationSchema.safeParse({
        participants: [user1, user2],
        participant_names: { [user1]: 'Alex', [user2]: 'Sam' },
        train_number: '12951',
        travel_date: '2026-09-15T00:00:00.000Z',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.participants).toEqual([user1, user2]);
        expect(result.data.travelDate).toBe('2026-09-15');
      }
    });

    it('rejects payload with fewer than 2 participants', () => {
      const result = createConversationSchema.safeParse({
        participants: [user1],
      });
      expect(result.success).toBe(false);
    });

    it('rejects self-conversation (duplicate participant IDs)', () => {
      const result = createConversationSchema.safeParse({
        participants: [user1, user1],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid travelDate format', () => {
      const result = createConversationSchema.safeParse({
        participants: [user1, user2],
        travelDate: 'invalid-date',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('conversationIdParamSchema', () => {
    it('accepts valid UUID', () => {
      const result = conversationIdParamSchema.safeParse({ id: user1 });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID', () => {
      const result = conversationIdParamSchema.safeParse({ id: 'abc' });
      expect(result.success).toBe(false);
    });
  });
});
