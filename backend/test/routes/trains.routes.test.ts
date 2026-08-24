import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { TrainService } from '../../src/services/train.service.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';

type FakeTrainService = Record<string, ReturnType<typeof vi.fn>>;

function createFakeTrainService(): FakeTrainService {
  return {
    search: vi.fn(),
    logUnverifiedTrain: vi.fn(),
  };
}

function buildApp(trainService: FakeTrainService): Express {
  return createApp({ trainService: trainService as unknown as TrainService });
}

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Train Routes (HTTP & Auth integration)', () => {
  describe('GET /trains', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeTrainService();
      const app = buildApp(service);

      const res = await request(app).get('/trains?q=raj');
      expect(res.status).toBe(401);
      expect(service.search).not.toHaveBeenCalled();
    });

    it('returns 200 with list of matching trains', async () => {
      const service = createFakeTrainService();
      const mockTrains = [
        { trainNumber: '12301', trainName: 'Howrah Rajdhani Express', active: true },
      ];
      service.search.mockResolvedValue(mockTrains);
      const app = buildApp(service);

      const res = await request(app)
        .get('/trains?q=raj&limit=10')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          train_number: '12301',
          train_name: 'Howrah Rajdhani Express',
        },
      ]);
      expect(service.search).toHaveBeenCalledWith('raj', 10);
    });
  });

  describe('POST /trains/unverified', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeTrainService();
      const app = buildApp(service);

      const res = await request(app).post('/trains/unverified').send({
        train_number: '99999',
      });
      expect(res.status).toBe(401);
      expect(service.logUnverifiedTrain).not.toHaveBeenCalled();
    });

    it('validates input and logs unverified train (201 Created)', async () => {
      const service = createFakeTrainService();
      const mockCreated = {
        id: 'uv-1',
        trainNumber: '99999',
        trainName: 'Summer Spl',
        submittedBy: USER1,
        createdAt: new Date('2026-08-24T12:00:00.000Z'),
      };
      service.logUnverifiedTrain.mockResolvedValue(mockCreated);
      const app = buildApp(service);

      const res = await request(app)
        .post('/trains/unverified')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          train_number: '99999',
          train_name: 'Summer Spl',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: 'uv-1',
        train_number: '99999',
        train_name: 'Summer Spl',
        submitted_by: USER1,
        created_at: '2026-08-24T12:00:00.000Z',
      });
      expect(service.logUnverifiedTrain).toHaveBeenCalledWith({
        trainNumber: '99999',
        trainName: 'Summer Spl',
        submittedBy: USER1,
      });
    });
  });
});
