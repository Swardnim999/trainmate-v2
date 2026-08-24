import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { RequestService } from '../../src/services/request.service.js';
import { AppError, NotFoundError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const USER3 = '00000000-0000-4000-8000-000000000003';
const REQ_ID = '11111111-1111-4000-8000-111111111111';

type FakeRequestService = Record<string, ReturnType<typeof vi.fn>>;

function createFakeRequestService(): FakeRequestService {
  return {
    listUserRequests: vi.fn(),
    listAcceptedRequests: vi.fn(),
    getIncomingPendingCount: vi.fn(),
    sendRequest: vi.fn(),
    updateStatus: vi.fn(),
    cancelRequest: vi.fn(),
    cleanupExpiredRequests: vi.fn(),
  };
}

function buildApp(requestService: FakeRequestService): Express {
  return createApp({ requestService: requestService as unknown as RequestService });
}

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Request Routes (HTTP & Auth integration)', () => {
  const mockRequestData = {
    id: REQ_ID,
    fromUserId: USER1,
    fromEmail: null,
    fromName: 'Aarav',
    toUserId: USER2,
    toEmail: null,
    toName: 'Priya',
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    boardingStation: 'Mumbai Central',
    destinationStation: 'New Delhi',
    status: 'pending',
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    updatedAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  describe('GET /requests/me', () => {
    it('requires authentication (401 without bearer token)', async () => {
      const service = createFakeRequestService();
      const app = buildApp(service);

      const res = await request(app).get('/requests/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
      expect(service.listUserRequests).not.toHaveBeenCalled();
    });

    it('returns 200 with list of user requests with dual camelCase/snake_case formatting', async () => {
      const service = createFakeRequestService();
      service.listUserRequests.mockResolvedValue([mockRequestData]);
      const app = buildApp(service);

      const res = await request(app)
        .get('/requests/me?type=sent')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          id: REQ_ID,
          from_user_id: USER1,
          fromUserId: USER1,
          to_user_id: USER2,
          toUserId: USER2,
          travel_date: '2026-09-15',
          travelDate: '2026-09-15',
          status: 'pending',
        }),
      ]);
      expect(service.listUserRequests).toHaveBeenCalledWith(USER1, 'sent');
    });
  });

  describe('GET /requests/me/accepted', () => {
    it('returns 200 with accepted requests', async () => {
      const service = createFakeRequestService();
      service.listAcceptedRequests.mockResolvedValue([{ ...mockRequestData, status: 'accepted' }]);
      const app = buildApp(service);

      const res = await request(app)
        .get('/requests/me/accepted')
        .set('Authorization', `Bearer ${await userToken()}`);

      expect(res.status).toBe(200);
      expect(res.body[0].status).toBe('accepted');
      expect(service.listAcceptedRequests).toHaveBeenCalledWith(USER1);
    });
  });

  describe('GET /requests/incoming/pending-count', () => {
    it('returns 200 with incoming pending count', async () => {
      const service = createFakeRequestService();
      service.getIncomingPendingCount.mockResolvedValue(4);
      const app = buildApp(service);

      const res = await request(app)
        .get('/requests/incoming/pending-count')
        .set('Authorization', `Bearer ${await userToken(USER2)}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 4 });
      expect(service.getIncomingPendingCount).toHaveBeenCalledWith(USER2);
    });
  });

  describe('POST /requests', () => {
    it('requires authentication (401)', async () => {
      const service = createFakeRequestService();
      const app = buildApp(service);

      const res = await request(app).post('/requests').send({
        to_user_id: USER2,
        travel_date: '2026-09-15',
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });

    it('returns 201 with created request for valid payload', async () => {
      const service = createFakeRequestService();
      service.sendRequest.mockResolvedValue(mockRequestData);
      const app = buildApp(service);

      const res = await request(app)
        .post('/requests')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          to_user_id: USER2,
          from_name: 'Aarav',
          to_name: 'Priya',
          train_number: '12951',
          travel_date: '2026-09-15',
          boarding_station: 'Mumbai Central',
          destination_station: 'New Delhi',
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual(
        expect.objectContaining({
          id: REQ_ID,
          from_user_id: USER1,
          to_user_id: USER2,
          status: 'pending',
        }),
      );
      expect(service.sendRequest).toHaveBeenCalledWith(USER1, {
        toUserId: USER2,
        fromName: 'Aarav',
        toName: 'Priya',
        trainNumber: '12951',
        travelDate: '2026-09-15',
        boardingStation: 'Mumbai Central',
        destinationStation: 'New Delhi',
      });
    });

    it('maps NO_MATCHING_JOURNEY error to 400 with code', async () => {
      const service = createFakeRequestService();
      service.sendRequest.mockRejectedValue(
        new AppError(400, 'NO_MATCHING_JOURNEY', 'No matching journey found'),
      );
      const app = buildApp(service);

      const res = await request(app)
        .post('/requests')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          to_user_id: USER2,
          travel_date: '2026-09-15',
          train_number: '12951',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_MATCHING_JOURNEY');
    });

    it('maps REQUEST_ALREADY_PENDING error to 409', async () => {
      const service = createFakeRequestService();
      service.sendRequest.mockRejectedValue(
        new AppError(409, 'REQUEST_ALREADY_PENDING', 'Request already pending'),
      );
      const app = buildApp(service);

      const res = await request(app)
        .post('/requests')
        .set('Authorization', `Bearer ${await userToken()}`)
        .send({
          to_user_id: USER2,
          travel_date: '2026-09-15',
          train_number: '12951',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REQUEST_ALREADY_PENDING');
    });
  });

  describe('PATCH /requests/:id', () => {
    it('accepts pending request (200)', async () => {
      const service = createFakeRequestService();
      service.updateStatus.mockResolvedValue({ ...mockRequestData, status: 'accepted' });
      const app = buildApp(service);

      const res = await request(app)
        .patch(`/requests/${REQ_ID}`)
        .set('Authorization', `Bearer ${await userToken(USER2)}`)
        .send({ status: 'accepted' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      expect(service.updateStatus).toHaveBeenCalledWith(USER2, REQ_ID, 'accepted');
    });

    it('returns 404 when request not found or caller not recipient', async () => {
      const service = createFakeRequestService();
      service.updateStatus.mockRejectedValue(new NotFoundError('Request not found'));
      const app = buildApp(service);

      const res = await request(app)
        .patch(`/requests/${REQ_ID}`)
        .set('Authorization', `Bearer ${await userToken(USER3)}`)
        .send({ status: 'accepted' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /requests/:id', () => {
    it('cancels pending request (204)', async () => {
      const service = createFakeRequestService();
      service.cancelRequest.mockResolvedValue(undefined);
      const app = buildApp(service);

      const res = await request(app)
        .delete(`/requests/${REQ_ID}`)
        .set('Authorization', `Bearer ${await userToken(USER1)}`);

      expect(res.status).toBe(204);
      expect(service.cancelRequest).toHaveBeenCalledWith(USER1, REQ_ID);
    });

    it('returns 404 on cancellation if not pending or not owner', async () => {
      const service = createFakeRequestService();
      service.cancelRequest.mockRejectedValue(new NotFoundError('Request not found'));
      const app = buildApp(service);

      const res = await request(app)
        .delete(`/requests/${REQ_ID}`)
        .set('Authorization', `Bearer ${await userToken(USER2)}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });

  describe('POST /requests/cleanup-expired', () => {
    it('cleans up expired requests (200)', async () => {
      const service = createFakeRequestService();
      service.cleanupExpiredRequests.mockResolvedValue(2);
      const app = buildApp(service);

      const res = await request(app)
        .post('/requests/cleanup-expired')
        .set('Authorization', `Bearer ${await userToken(USER1)}`)
        .send({ cutoff_date: '2026-09-13' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 2 });
      expect(service.cleanupExpiredRequests).toHaveBeenCalledWith(USER1, '2026-09-13');
    });
  });
});
