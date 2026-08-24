import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { ModerationService } from '../../src/services/moderation.service.js';
import { AppError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const BLOCK_ID = '11111111-1111-4000-8000-111111111111';
const REPORT_ID = '22222222-2222-4000-8000-222222222222';

type FakeModeration = Record<string, ReturnType<typeof vi.fn>>;

function createFakeModeration(): FakeModeration {
  return {
    getBlockedUsers: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    reportUser: vi.fn(),
  };
}

function buildApp(moderation: FakeModeration): Express {
  return createApp({ moderation: moderation as unknown as ModerationService });
}

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /blocked-users', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);

    const res = await request(app).get('/blocked-users');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(moderation.getBlockedUsers).not.toHaveBeenCalled();
  });

  it('returns 200 with list of blocked users for authenticated user', async () => {
    const moderation = createFakeModeration();
    moderation.getBlockedUsers.mockResolvedValue([{ blocked_id: USER2 }]);
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app).get('/blocked-users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ blocked_id: USER2 }]);
    expect(moderation.getBlockedUsers).toHaveBeenCalledWith(USER1);
  });
});

describe('POST /blocked-users', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);

    const res = await request(app).post('/blocked-users').send({ blocked_id: USER2 });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(moderation.blockUser).not.toHaveBeenCalled();
  });

  it('rejects malformed/non-UUID blocked_id with 400 VALIDATION_ERROR', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(moderation.blockUser).not.toHaveBeenCalled();
  });

  it('surfaces service self-block rejection as 400 VALIDATION_ERROR', async () => {
    const moderation = createFakeModeration();
    moderation.blockUser.mockRejectedValue(
      new AppError(400, 'VALIDATION_ERROR', 'Cannot block yourself'),
    );
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: USER1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Cannot block yourself');
  });

  it('surfaces missing target user as 404 USER_NOT_FOUND', async () => {
    const moderation = createFakeModeration();
    moderation.blockUser.mockRejectedValue(new AppError(404, 'USER_NOT_FOUND', 'User not found'));
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: USER2 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('successfully blocks user and returns 200 with block record', async () => {
    const moderation = createFakeModeration();
    const mockBlock = { id: BLOCK_ID, blockerId: USER1, blockedId: USER2 };
    moderation.blockUser.mockResolvedValue(mockBlock);
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: USER2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockBlock);
    expect(moderation.blockUser).toHaveBeenCalledWith(USER1, USER2);
  });

  it('forces blocker_id from JWT and ignores spoofed blocker_id in request body', async () => {
    const moderation = createFakeModeration();
    const mockBlock = { id: BLOCK_ID, blockerId: USER1, blockedId: USER2 };
    moderation.blockUser.mockResolvedValue(mockBlock);
    const app = buildApp(moderation);
    const token = await userToken(USER1);

    const res = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocker_id: '00000000-0000-4000-8000-999999999999', blocked_id: USER2 });

    expect(res.status).toBe(200);
    expect(moderation.blockUser).toHaveBeenCalledWith(USER1, USER2);
  });
});

describe('DELETE /blocked-users/:blockedId', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);

    const res = await request(app).delete(`/blocked-users/${USER2}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(moderation.unblockUser).not.toHaveBeenCalled();
  });

  it('rejects malformed/non-UUID param with 400 VALIDATION_ERROR', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .delete('/blocked-users/not-a-valid-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(moderation.unblockUser).not.toHaveBeenCalled();
  });

  it('successfully unblocks user and returns 204 No Content', async () => {
    const moderation = createFakeModeration();
    moderation.unblockUser.mockResolvedValue(undefined);
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .delete(`/blocked-users/${USER2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect(moderation.unblockUser).toHaveBeenCalledWith(USER1, USER2);
  });
});

describe('POST /reports', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);

    const res = await request(app)
      .post('/reports')
      .send({ reported_id: USER2, reason: 'Harassment' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(moderation.reportUser).not.toHaveBeenCalled();
  });

  it('rejects malformed/non-UUID reported_id with 400 VALIDATION_ERROR', async () => {
    const moderation = createFakeModeration();
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ reported_id: 'bad-uuid', reason: 'Some reason' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(moderation.reportUser).not.toHaveBeenCalled();
  });

  it('surfaces service self-report rejection as 400 VALIDATION_ERROR', async () => {
    const moderation = createFakeModeration();
    moderation.reportUser.mockRejectedValue(
      new AppError(400, 'VALIDATION_ERROR', 'Cannot report yourself'),
    );
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ reported_id: USER1, reason: 'Self-reporting' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('Cannot report yourself');
  });

  it('surfaces missing target user as 404 USER_NOT_FOUND', async () => {
    const moderation = createFakeModeration();
    moderation.reportUser.mockRejectedValue(new AppError(404, 'USER_NOT_FOUND', 'User not found'));
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ reported_id: USER2 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('successfully creates report and returns 201 with report record', async () => {
    const moderation = createFakeModeration();
    const mockReport = {
      id: REPORT_ID,
      reporterId: USER1,
      reportedId: USER2,
      reason: 'Inappropriate behavior',
    };
    moderation.reportUser.mockResolvedValue(mockReport);
    const app = buildApp(moderation);
    const token = await userToken();

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ reported_id: USER2, reason: 'Inappropriate behavior' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(mockReport);
    expect(moderation.reportUser).toHaveBeenCalledWith(USER1, USER2, 'Inappropriate behavior');
  });

  it('forces reporter_id from JWT and ignores spoofed reporter_id in request body', async () => {
    const moderation = createFakeModeration();
    const mockReport = { id: REPORT_ID, reporterId: USER1, reportedId: USER2 };
    moderation.reportUser.mockResolvedValue(mockReport);
    const app = buildApp(moderation);
    const token = await userToken(USER1);

    const res = await request(app)
      .post('/reports')
      .set('Authorization', `Bearer ${token}`)
      .send({ reporter_id: '00000000-0000-4000-8000-999999999999', reported_id: USER2 });

    expect(res.status).toBe(201);
    expect(moderation.reportUser).toHaveBeenCalledWith(USER1, USER2, undefined);
  });
});
