import { describe, it, expect } from 'vitest';
import {
  createRequestSchema,
  updateRequestStatusSchema,
  requestIdParamSchema,
  listRequestsQuerySchema,
  cleanupExpiredRequestsSchema,
} from '../../src/validation/request.schemas.js';

describe('Request Validation Schemas', () => {
  const validUuid = '11111111-1111-1111-1111-111111111111';

  describe('createRequestSchema', () => {
    it('parses valid camelCase request input and normalizes date', () => {
      const result = createRequestSchema.safeParse({
        toUserId: validUuid,
        fromName: 'Aarav',
        toName: 'Priya',
        trainNumber: '12951',
        travelDate: '2026-09-15',
        boardingStation: 'Mumbai',
        destinationStation: 'Delhi',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toUserId).toBe(validUuid);
        expect(result.data.fromName).toBe('Aarav');
        expect(result.data.toName).toBe('Priya');
        expect(result.data.trainNumber).toBe('12951');
        expect(result.data.travelDate).toBe('2026-09-15');
        expect(result.data.boardingStation).toBe('Mumbai');
        expect(result.data.destinationStation).toBe('Delhi');
      }
    });

    it('parses valid snake_case request input from frontend', () => {
      const result = createRequestSchema.safeParse({
        to_user_id: validUuid,
        from_name: 'Aarav',
        to_name: 'Priya',
        train_number: '12951',
        travel_date: '2026-09-15T00:00:00.000Z',
        boarding_station: 'Mumbai',
        destination_station: 'Delhi',
        status: 'pending',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.toUserId).toBe(validUuid);
        expect(result.data.travelDate).toBe('2026-09-15');
      }
    });

    it('rejects missing recipient toUserId', () => {
      const result = createRequestSchema.safeParse({
        travelDate: '2026-09-15',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid recipient UUID', () => {
      const result = createRequestSchema.safeParse({
        toUserId: 'not-a-uuid',
        travelDate: '2026-09-15',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid travelDate format', () => {
      const result = createRequestSchema.safeParse({
        toUserId: validUuid,
        travelDate: 'invalid-date',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateRequestStatusSchema', () => {
    it('accepts accepted and rejected statuses', () => {
      expect(updateRequestStatusSchema.safeParse({ status: 'accepted' }).success).toBe(true);
      expect(updateRequestStatusSchema.safeParse({ status: 'rejected' }).success).toBe(true);
    });

    it('rejects invalid or arbitrary statuses like pending or cancelled', () => {
      expect(updateRequestStatusSchema.safeParse({ status: 'pending' }).success).toBe(false);
      expect(updateRequestStatusSchema.safeParse({ status: 'cancelled' }).success).toBe(false);
      expect(updateRequestStatusSchema.safeParse({ status: 'random' }).success).toBe(false);
    });
  });

  describe('requestIdParamSchema', () => {
    it('accepts valid UUID param', () => {
      expect(requestIdParamSchema.safeParse({ id: validUuid }).success).toBe(true);
    });

    it('rejects non-UUID param', () => {
      expect(requestIdParamSchema.safeParse({ id: '123' }).success).toBe(false);
    });
  });

  describe('listRequestsQuerySchema', () => {
    it('defaults type to all when omitted', () => {
      const result = listRequestsQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('all');
      }
    });

    it('accepts sent and received types', () => {
      expect(listRequestsQuerySchema.safeParse({ type: 'sent' }).success).toBe(true);
      expect(listRequestsQuerySchema.safeParse({ type: 'received' }).success).toBe(true);
    });

    it('rejects invalid type', () => {
      expect(listRequestsQuerySchema.safeParse({ type: 'invalid' }).success).toBe(false);
    });
  });

  describe('cleanupExpiredRequestsSchema', () => {
    it('parses valid cutoffDate in camelCase or snake_case', () => {
      const r1 = cleanupExpiredRequestsSchema.safeParse({ cutoffDate: '2026-09-13' });
      expect(r1.success).toBe(true);
      if (r1.success) expect(r1.data.cutoffDate).toBe('2026-09-13');

      const r2 = cleanupExpiredRequestsSchema.safeParse({ cutoff_date: '2026-09-13' });
      expect(r2.success).toBe(true);
      if (r2.success) expect(r2.data.cutoffDate).toBe('2026-09-13');
    });

    it('accepts omitted cutoffDate', () => {
      const result = cleanupExpiredRequestsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.cutoffDate).toBeUndefined();
    });
  });
});
