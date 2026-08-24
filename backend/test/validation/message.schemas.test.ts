import { describe, it, expect } from 'vitest';
import {
  sendMessageSchema,
  lastReadParamSchema,
  listMessagesQuerySchema,
} from '../../src/validation/message.schemas.js';

describe('Message Validation Schemas (Unit)', () => {
  const user1 = '00000000-0000-4000-8000-000000000001';
  const conv1 = 'c1111111-1111-4111-8111-111111111111';

  describe('sendMessageSchema', () => {
    it('parses valid text-only message', () => {
      const result = sendMessageSchema.safeParse({
        text: 'Hello, I am on the train!',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.text).toBe('Hello, I am on the train!');
        expect(result.data.attachmentUrl).toBeNull();
      }
    });

    it('parses valid attachment-only message with empty text', () => {
      const result = sendMessageSchema.safeParse({
        text: '',
        attachment_url: 'https://example.com/photo.jpg',
        attachment_type: 'image/jpeg',
        attachment_name: 'photo.jpg',
        attachment_size: 1048576,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.text).toBe('');
        expect(result.data.attachmentUrl).toBe('https://example.com/photo.jpg');
        expect(result.data.attachmentType).toBe('image/jpeg');
      }
    });

    it('rejects empty text without attachment', () => {
      const result = sendMessageSchema.safeParse({
        text: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects text exceeding 2000 characters', () => {
      const result = sendMessageSchema.safeParse({
        text: 'a'.repeat(2001),
      });
      expect(result.success).toBe(false);
    });

    it('rejects disallowed MIME type (SVG)', () => {
      const result = sendMessageSchema.safeParse({
        text: '',
        attachmentUrl: 'https://example.com/vector.svg',
        attachmentType: 'image/svg+xml',
      });
      expect(result.success).toBe(false);
    });

    it('rejects disallowed MIME type (HTML)', () => {
      const result = sendMessageSchema.safeParse({
        text: '',
        attachmentUrl: 'https://example.com/page.html',
        attachmentType: 'text/html',
      });
      expect(result.success).toBe(false);
    });

    it('rejects attachment size exceeding 10MB', () => {
      const result = sendMessageSchema.safeParse({
        text: '',
        attachmentUrl: 'https://example.com/large.pdf',
        attachmentType: 'application/pdf',
        attachmentSize: 11 * 1024 * 1024,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('lastReadParamSchema', () => {
    it('accepts valid UUIDs for id and userId', () => {
      const result = lastReadParamSchema.safeParse({
        id: conv1,
        userId: user1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUIDs', () => {
      const result = lastReadParamSchema.safeParse({
        id: 'invalid-conv-id',
        userId: user1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('listMessagesQuerySchema', () => {
    it('defaults limit to 100', () => {
      const result = listMessagesQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
      }
    });

    it('clamps limit between 1 and 100', () => {
      const result = listMessagesQuerySchema.safeParse({ limit: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });
  });
});
