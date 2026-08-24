import { describe, it, expect } from 'vitest';
import type { Journey, Train, UnverifiedTrain } from '@prisma/client';
import { JourneySerializer, formatTravelDate } from '../../src/serializers/journey.serializer.js';

describe('JourneySerializer (Unit)', () => {
  const sampleDate = new Date('2026-09-15T00:00:00.000Z');
  const sampleCreatedAt = new Date('2026-08-24T12:00:00.000Z');

  const mockJourney: Journey = {
    id: '11111111-1111-4000-8000-111111111111',
    userId: '00000000-0000-4000-8000-000000000001',
    userName: 'Alex Smith',
    trainNumber: '12301',
    trainName: 'Howrah Rajdhani Express',
    travelDate: sampleDate,
    coach: 'B1',
    boardingStation: 'New Delhi',
    destinationStation: 'Howrah',
    college: 'IIT Delhi',
    gender: 'prefer-not-to-say',
    createdAt: sampleCreatedAt,
  };

  describe('formatTravelDate', () => {
    it('formats Date object to YYYY-MM-DD', () => {
      expect(formatTravelDate(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05');
    });

    it('formats string date to YYYY-MM-DD', () => {
      expect(formatTravelDate('2026-10-05T14:30:00.000Z')).toBe('2026-10-05');
    });
  });

  describe('toResponse', () => {
    it('serializes Journey to snake_case response object', () => {
      const res = JourneySerializer.toResponse(mockJourney);

      expect(res).toEqual({
        id: '11111111-1111-4000-8000-111111111111',
        user_id: '00000000-0000-4000-8000-000000000001',
        user_name: 'Alex Smith',
        train_number: '12301',
        train_name: 'Howrah Rajdhani Express',
        travel_date: '2026-09-15',
        coach: 'B1',
        boarding_station: 'New Delhi',
        destination_station: 'Howrah',
        college: 'IIT Delhi',
        gender: 'prefer-not-to-say',
        created_at: '2026-08-24T12:00:00.000Z',
      });
    });

    it('STRICT PRIVACY INVARIANT: never returns email field', () => {
      const journeyWithEmail = {
        ...mockJourney,
        email: 'secret@domain.com',
        user_email: 'secret@domain.com',
      };
      const res = JourneySerializer.toResponse(journeyWithEmail as unknown as Journey);

      expect((res as Record<string, unknown>).email).toBeUndefined();
      expect((res as Record<string, unknown>).user_email).toBeUndefined();
      expect(Object.keys(res)).not.toContain('email');
      expect(Object.keys(res)).not.toContain('user_email');
    });
  });

  describe('toResponseList', () => {
    it('serializes array of journeys', () => {
      const list = JourneySerializer.toResponseList([mockJourney]);
      expect(list).toHaveLength(1);
      expect(list[0]?.id).toBe(mockJourney.id);
    });
  });

  describe('toTrainResponse & toTrainResponseList', () => {
    it('serializes Train models', () => {
      const mockTrain: Train = {
        trainNumber: '12301',
        trainName: 'Howrah Rajdhani',
        active: true,
      };
      const res = JourneySerializer.toTrainResponse(mockTrain);
      expect(res).toEqual({
        train_number: '12301',
        train_name: 'Howrah Rajdhani',
      });

      const list = JourneySerializer.toTrainResponseList([mockTrain]);
      expect(list).toEqual([{ train_number: '12301', train_name: 'Howrah Rajdhani' }]);
    });
  });

  describe('toUnverifiedTrainResponse', () => {
    it('serializes UnverifiedTrain models', () => {
      const mockEntry: UnverifiedTrain = {
        id: 'uv-1',
        trainNumber: '99999',
        trainName: 'Special Train',
        enteredValue: '99999',
        normalizedValue: '99999',
        submittedBy: 'u-1',
        createdAt: sampleCreatedAt,
      };
      const res = JourneySerializer.toUnverifiedTrainResponse(mockEntry);
      expect(res).toEqual({
        id: 'uv-1',
        train_number: '99999',
        train_name: 'Special Train',
        submitted_by: 'u-1',
        created_at: '2026-08-24T12:00:00.000Z',
      });
    });
  });
});
