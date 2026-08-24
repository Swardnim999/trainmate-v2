import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { ProfileService } from '../../src/services/profile.service.js';
import { AppError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';

type FakeProfileService = Record<string, ReturnType<typeof vi.fn>>;

function createFakeProfileService(): FakeProfileService {
  return {
    getOwnProfile: vi.fn(),
    updateOwnProfile: vi.fn(),
    getPublicProfile: vi.fn(),
    getProfileName: vi.fn(),
    bootstrapProfile: vi.fn(),
  };
}

function buildApp(profileService: FakeProfileService): Express {
  return createApp({ profileService: profileService as unknown as ProfileService });
}

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('GET /profiles/me', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);

    const res = await request(app).get('/profiles/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(service.getOwnProfile).not.toHaveBeenCalled();
  });

  it('returns 200 with own profile data including email', async () => {
    const service = createFakeProfileService();
    const mockProfile = {
      id: USER1,
      email: 'u1@example.com',
      name: 'User One',
      bio: 'Bio text',
      hobbies: 'Chess',
      college: 'IIT Delhi',
      gender: 'male',
      avatar_url: 'https://avatar.png',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };
    service.getOwnProfile.mockResolvedValue(mockProfile);
    const app = buildApp(service);
    const token = await userToken(USER1, 'u1@example.com');

    const res = await request(app).get('/profiles/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockProfile);
    expect(service.getOwnProfile).toHaveBeenCalledWith(USER1);
  });
});

describe('PATCH /profiles/me', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);

    const res = await request(app).patch('/profiles/me').send({ name: 'New' });

    expect(res.status).toBe(401);
    expect(service.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid inputs with 400 (e.g. name > 100 chars)', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'a'.repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.updateOwnProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid gender enum with 400', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ gender: 'unsupported_gender' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('updates profile and returns 200 with updated profile', async () => {
    const service = createFakeProfileService();
    const mockUpdated = {
      id: USER1,
      email: 'u1@example.com',
      name: 'Alex',
      bio: 'New Bio',
      hobbies: null,
      college: null,
      gender: 'prefer_not_to_say',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };
    service.updateOwnProfile.mockResolvedValue(mockUpdated);
    const app = buildApp(service);
    const token = await userToken(USER1);

    const res = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Alex',
        bio: 'New Bio',
        gender: 'prefer-not-to-say',
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockUpdated);
    expect(service.updateOwnProfile).toHaveBeenCalledWith(USER1, {
      name: 'Alex',
      bio: 'New Bio',
      gender: 'prefer-not-to-say',
    });
  });
});

describe('GET /profiles/:userId/name', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);

    const res = await request(app).get(`/profiles/${USER2}/name`);

    expect(res.status).toBe(401);
  });

  it('rejects malformed UUID with 400', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .get('/profiles/not-a-uuid/name')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with display name', async () => {
    const service = createFakeProfileService();
    service.getProfileName.mockResolvedValue({ name: 'Sam Taylor' });
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .get(`/profiles/${USER2}/name`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Sam Taylor' });
    expect(service.getProfileName).toHaveBeenCalledWith(USER1, USER2);
  });
});

describe('GET /profiles/:userId', () => {
  it('requires authentication (401 without bearer token)', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);

    const res = await request(app).get(`/profiles/${USER2}`);

    expect(res.status).toBe(401);
  });

  it('rejects malformed UUID with 400', async () => {
    const service = createFakeProfileService();
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .get('/profiles/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 USER_NOT_FOUND when user is unauthorized, blocked, or not found (probing defense)', async () => {
    const service = createFakeProfileService();
    service.getPublicProfile.mockRejectedValue(
      new AppError(404, 'USER_NOT_FOUND', 'User not found'),
    );
    const app = buildApp(service);
    const token = await userToken();

    const res = await request(app)
      .get(`/profiles/${USER2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('returns 200 with public profile and NEVER contains email', async () => {
    const service = createFakeProfileService();
    const mockPublicProfile = {
      id: USER2,
      name: 'Sam Taylor',
      bio: 'Bio text',
      hobbies: 'Chess',
      college: 'BITS',
      gender: 'female',
      avatar_url: 'https://avatar.png',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    };
    service.getPublicProfile.mockResolvedValue(mockPublicProfile);
    const app = buildApp(service);
    const token = await userToken(USER1);

    const res = await request(app)
      .get(`/profiles/${USER2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(mockPublicProfile);
    // Hard security assertion
    expect('email' in res.body).toBe(false);
    expect(res.body.email).toBeUndefined();
    expect(service.getPublicProfile).toHaveBeenCalledWith(USER1, USER2);
  });
});
