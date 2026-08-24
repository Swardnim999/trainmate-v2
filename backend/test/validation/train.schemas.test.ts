import { describe, it, expect } from 'vitest';
import {
  trainSearchQuerySchema,
  createUnverifiedTrainSchema,
} from '../../src/validation/train.schemas.js';

describe('Train Schemas (Unit)', () => {
  describe('trainSearchQuerySchema', () => {
    it('accepts search query and parses limit', () => {
      const result = trainSearchQuerySchema.safeParse({ q: 'raj', limit: '10' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ q: 'raj', limit: 10 });
      }
    });

    it('defaults query to empty string and limit to 15', () => {
      const result = trainSearchQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ q: '', limit: 15 });
      }
    });
  });

  describe('createUnverifiedTrainSchema', () => {
    it('validates snake_case input and returns normalized output', () => {
      const result = createUnverifiedTrainSchema.safeParse({
        train_number: '  99999  ',
        train_name: '  Summer Special  ',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          trainNumber: '99999',
          trainName: 'Summer Special',
        });
      }
    });

    it('rejects missing train number', () => {
      const result = createUnverifiedTrainSchema.safeParse({
        train_name: 'Summer Special',
      });
      expect(result.success).toBe(false);
    });

    it('rejects train number exceeding 20 chars', () => {
      const result = createUnverifiedTrainSchema.safeParse({
        train_number: '123456789012345678901',
      });
      expect(result.success).toBe(false);
    });
  });
});
