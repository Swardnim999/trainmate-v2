import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { JourneyService } from '../../src/services/journey.service.js';
import { AppError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const JOURNEY_ID = '11111111-1111-4000-8000-111111111111';

type FakeJourneyService = Record<string, ReturnType<typeof vi.fn>>;

function createFakeJourneyService(): FakeJourneyService {
  return {
    listUserJourneys: vi.fn(),
    createJourney: vi.fn(),
    deleteJourney: vi.fn(),
    findCompanions: vi.fn(),
  };
}

function buildApp(journeyService: FakeJourneyService): Express {
  return createApp({ journeyService: journeyService as unknown as JourneyService });
}

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Journey Routes (HTTP & Auth integration)', () => {
  describe('GET /journeys/me', () => {
    it('requires authentication (401 without bearer token)', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app).get('/journeys/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
      expect(service.listUserJourneys).not.toHaveBeenCalled();
    });

    it('returns 200 with list of user journeys', async () => {
      const service = createFakeJourneyService();
      const mockJourney = {
        id: JOURNEY_ID,
        userId: USER1,
        userName: 'Alex',
        trainNumber: '12301',
        trainName: 'Howrah Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: 'B1',
        boardingStation: 'NDLS',
        destinationStation: 'HWH',
        college: 'IIT',
        gender: 'prefer-not-to-say',
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      service.listUserJourneys.mockResolvedValue([mockJourney]);
      const app = buildApp(service);

      const res = await request(app)
        .get('/journeys/me')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: JOURNEY_ID,
          user_id: USER1,
          user_name: 'Alex',
          train_number: '12301',
          train_name: 'Howrah Rajdhani',
          travel_date: '2026-09-15',
          coach: 'B1',
          boarding_station: 'NDLS',
          destination_station: 'HWH',
          college: 'IIT',
          gender: 'prefer-not-to-say',
          created_at: '2026-08-24T12:00:00.000Z',
        },
      ]);
      expect(service.listUserJourneys).toHaveBeenCalledWith(USER1);
    });
  });

  describe('POST /journeys', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app).post('/journeys').send({
        train_number: '12301',
        travel_date: '2026-09-15',
      });

      expect(res.status).toBe(401);
      expect(service.createJourney).not.toHaveBeenCalled();
    });

    it('validates input and returns 400 on invalid payload', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app)
        .post('/journeys')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          train_number: 'invalid@train!',
          travel_date: 'not-a-date',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(service.createJourney).not.toHaveBeenCalled();
    });

    it('creates journey and returns 201 Created', async () => {
      const service = createFakeJourneyService();
      const mockCreated = {
        id: JOURNEY_ID,
        userId: USER1,
        userName: 'Alex',
        trainNumber: '12301',
        trainName: 'Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: 'B1',
        boardingStation: 'NDLS',
        destinationStation: 'HWH',
        college: null,
        gender: null,
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      service.createJourney.mockResolvedValue(mockCreated);
      const app = buildApp(service);

      const res = await request(app)
        .post('/journeys')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          train_number: '12301',
          travel_date: '2026-09-15',
          coach: 'B1',
          boarding_station: 'NDLS',
          destination_station: 'HWH',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: JOURNEY_ID,
        user_id: USER1,
        user_name: 'Alex',
        train_number: '12301',
        train_name: 'Rajdhani',
        travel_date: '2026-09-15',
        coach: 'B1',
        boarding_station: 'NDLS',
        destination_station: 'HWH',
        college: null,
        gender: null,
        created_at: '2026-08-24T12:00:00.000Z',
      });
      expect(service.createJourney).toHaveBeenCalledWith(USER1, {
        trainNumber: '12301',
        trainName: null,
        travelDate: '2026-09-15',
        coach: 'B1',
        boardingStation: 'NDLS',
        destinationStation: 'HWH',
        college: null,
        gender: null,
        userName: null,
        isTrainVerified: undefined,
      });
    });
  });

  describe('DELETE /journeys/:id', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app).delete(`/journeys/${JOURNEY_ID}`);
      expect(res.status).toBe(401);
      expect(service.deleteJourney).not.toHaveBeenCalled();
    });

    it('returns 400 for non-UUID journey ID', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app)
        .delete('/journeys/not-a-uuid')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 204 on successful deletion', async () => {
      const service = createFakeJourneyService();
      service.deleteJourney.mockResolvedValue(undefined);
      const app = buildApp(service);

      const res = await request(app)
        .delete(`/journeys/${JOURNEY_ID}`)
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(204);
      expect(service.deleteJourney).toHaveBeenCalledWith(JOURNEY_ID, USER1);
    });

    it('returns 404 when journey does not exist or belongs to another user', async () => {
      const service = createFakeJourneyService();
      service.deleteJourney.mockRejectedValue(
        new AppError(404, 'JOURNEY_NOT_FOUND', 'Journey not found'),
      );
      const app = buildApp(service);

      const res = await request(app)
        .delete(`/journeys/${JOURNEY_ID}`)
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('JOURNEY_NOT_FOUND');
    });
  });

  describe('GET /journeys/:trainNumber/:travelDate/companions', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeJourneyService();
      const app = buildApp(service);

      const res = await request(app).get('/journeys/12301/2026-09-15/companions');
      expect(res.status).toBe(401);
      expect(service.findCompanions).not.toHaveBeenCalled();
    });

    it('returns 200 with companion matches', async () => {
      const service = createFakeJourneyService();
      const mockCompanion = {
        id: '22222222-2222-4000-8000-222222222222',
        userId: USER2,
        userName: 'Companion User',
        trainNumber: '12301',
        trainName: 'Rajdhani',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
        coach: 'B2',
        boardingStation: 'NDLS',
        destinationStation: 'CNB',
        college: 'BITS',
        gender: 'female',
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      service.findCompanions.mockResolvedValue([mockCompanion]);
      const app = buildApp(service);

      const res = await request(app)
        .get('/journeys/12301/2026-09-15/companions')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: '22222222-2222-4000-8000-222222222222',
          user_id: USER2,
          user_name: 'Companion User',
          train_number: '12301',
          train_name: 'Rajdhani',
          travel_date: '2026-09-15',
          coach: 'B2',
          boarding_station: 'NDLS',
          destination_station: 'CNB',
          college: 'BITS',
          gender: 'female',
          created_at: '2026-08-24T12:00:00.000Z',
        },
      ]);
      expect(service.findCompanions).toHaveBeenCalledWith(USER1, '12301', '2026-09-15');
    });
  });
});
