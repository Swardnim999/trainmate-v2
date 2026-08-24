import { describe, it, expect } from 'vitest';
import {
  createJourneySchema,
  journeyIdParamSchema,
  companionParamsSchema,
} from '../../src/validation/journey.schemas.js';

describe('Journey Schemas (Unit)', () => {
  describe('createJourneySchema', () => {
    it('validates and normalizes snake_case input', () => {
      const input = {
        train_number: '12301',
        train_name: 'Howrah Rajdhani',
        travel_date: '2026-09-15',
        coach: 'B1',
        boarding_station: 'New Delhi',
        destination_station: 'Howrah',
        college: 'IIT Delhi',
        gender: 'prefer-not-to-say',
        user_name: 'Alex',
        is_train_verified: true,
      };

      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({
          trainNumber: '12301',
          trainName: 'Howrah Rajdhani',
          travelDate: '2026-09-15',
          coach: 'B1',
          boardingStation: 'New Delhi',
          destinationStation: 'Howrah',
          college: 'IIT Delhi',
          gender: 'prefer-not-to-say',
          userName: 'Alex',
          isTrainVerified: true,
        });
      }
    });

    it('validates and normalizes camelCase input', () => {
      const input = {
        trainNumber: '12951',
        travelDate: '2026-10-01',
        boardingStation: 'Mumbai Central',
        destinationStation: 'New Delhi',
      };

      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.trainNumber).toBe('12951');
        expect(result.data.travelDate).toBe('2026-10-01');
      }
    });

    it('rejects missing train number', () => {
      const input = { travel_date: '2026-09-15' };
      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid train number characters', () => {
      const input = { train_number: '12301@#$', travel_date: '2026-09-15' };
      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing travel date', () => {
      const input = { train_number: '12301' };
      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid travel date format', () => {
      const input = { train_number: '12301', travel_date: '15-09-2026' };
      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid gender', () => {
      const input = {
        train_number: '12301',
        travel_date: '2026-09-15',
        gender: 'invalid-gender',
      };
      const result = createJourneySchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('journeyIdParamSchema', () => {
    it('accepts valid UUID', () => {
      const result = journeyIdParamSchema.safeParse({
        id: '11111111-1111-4000-8000-111111111111',
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID', () => {
      const result = journeyIdParamSchema.safeParse({ id: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('companionParamsSchema', () => {
    it('accepts valid trainNumber and travelDate', () => {
      const result = companionParamsSchema.safeParse({
        trainNumber: '12301',
        travelDate: '2026-09-15',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid travelDate in companion params', () => {
      const result = companionParamsSchema.safeParse({
        trainNumber: '12301',
        travelDate: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });
  });
});
