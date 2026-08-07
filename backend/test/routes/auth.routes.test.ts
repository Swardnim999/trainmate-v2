import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { AuthService, Session } from '../../src/services/auth.service.js';
import { AppError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';
import { InMemoryRateLimitStore, type RateLimitStore } from '../../src/middleware/rate-limit.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'user@example.com';
const DEFAULT_ORIGIN = 'http://localhost:5173';

const SESSION: Session = {
  access_token: 'access.abc',
  refresh_token: 'refresh.abc',
  expires_in: 900,
  token_type: 'bearer',
  user: { id: USER_ID, email: EMAIL },
};

type FakeAuth = Record<string, ReturnType<typeof vi.fn>>;

function createFakeAuth(): FakeAuth {
  return {
    register: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    resolveUserIdFromRefreshToken: vi.fn(),
    confirmEmail: vi.fn(),
    buildVerificationRedirect: vi.fn(),
    getSession: vi.fn(),
    resendVerification: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  };
}

/** Fresh app + fake service + fresh rate-limit store per test → no cross-test bleed. */
function buildApp(
  auth: FakeAuth,
  rateLimitStore: RateLimitStore = new InMemoryRateLimitStore(),
): Express {
  return createApp({ auth: auth as unknown as AuthService, rateLimitStore });
}

const jwt = new JwtService(env.JWT_SECRET);
async function accessToken(): Promise<string> {
  return jwt.sign({ id: USER_ID, email: EMAIL }, new Date(), 900);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('auth routes — happy path + error envelope mapping', () => {
  it('POST /auth/register returns 200 and normalizes the email before the service', async () => {
    const auth = createFakeAuth();
    auth.register.mockResolvedValue({
      user: { id: USER_ID, email: EMAIL },
      confirmationRequired: true,
    });
    const app = buildApp(auth);

    const res = await request(app).post('/auth/register').send({
      email: '  New@Example.com ',
      password: 'password123',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: USER_ID, email: EMAIL }, confirmationRequired: true });
    expect(auth.register).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'password123',
    });
  });

  it('POST /auth/register rejects a malformed email with 400 VALIDATION_ERROR before the service', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'nope', password: 'password123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('POST /auth/register rejects a weak password with 400 VALIDATION_ERROR', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    const res = await request(app).post('/auth/register').send({ email: EMAIL, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /auth/login maps service credentials errors to a 401 AUTH_INVALID_CREDENTIALS envelope', async () => {
    const auth = createFakeAuth();
    auth.login.mockRejectedValue(
      new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password'),
    );
    const app = buildApp(auth);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' },
    });
  });

  it('POST /auth/login rejects a malformed email at the boundary (400), not as a failed credential', async () => {
    const auth = createFakeAuth();
    auth.login.mockResolvedValue(SESSION);
    const app = buildApp(auth);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'not-an-email', password: 'whatever' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('POST /auth/refresh returns the rotated session', async () => {
    const auth = createFakeAuth();
    auth.refresh.mockResolvedValue(SESSION);
    const app = buildApp(auth);

    const res = await request(app).post('/auth/refresh').send({ refresh_token: 'refresh.old' });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBe('access.abc');
  });

  it('POST /auth/refresh maps an invalid refresh token to 401 AUTH_INVALID_TOKEN', async () => {
    const auth = createFakeAuth();
    auth.refresh.mockRejectedValue(
      new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired refresh token'),
    );
    const app = buildApp(auth);

    const res = await request(app).post('/auth/refresh').send({ refresh_token: 'refresh.garbage' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('GET /auth/session requires a bearer token (401 AUTH_REQUIRED)', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    const res = await request(app).get('/auth/session');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('GET /auth/session returns user + expiry for a valid access token', async () => {
    const auth = createFakeAuth();
    auth.getSession.mockResolvedValue({
      user: { id: USER_ID, email: EMAIL },
      expires_at: 1_700_000_000,
    });
    const app = buildApp(auth);

    const res = await request(app)
      .get('/auth/session')
      .set('Authorization', `Bearer ${await accessToken()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: { id: USER_ID, email: EMAIL }, expires_at: 1_700_000_000 });
  });

  it('GET /auth/session rejects an expired access token with 401 AUTH_TOKEN_EXPIRED', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);
    const expired = await jwt.sign(
      { id: USER_ID, email: EMAIL },
      new Date(Date.now() - 200_000),
      60,
    );

    const res = await request(app).get('/auth/session').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });
});

describe('auth routes — verify-email redirect flow', () => {
  it('GET /auth/verify-email redirects (302) to the built session-fragment URL on success', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockResolvedValue(SESSION);
    auth.buildVerificationRedirect.mockResolvedValue(
      `${DEFAULT_ORIGIN}/#access_token=x&token_type=bearer`,
    );
    const app = buildApp(auth);

    const res = await request(app).get('/auth/verify-email').query({ token: 'verify.abc' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${DEFAULT_ORIGIN}/#access_token=x&token_type=bearer`);
    expect(auth.confirmEmail).toHaveBeenCalledWith('verify.abc');
  });

  it('GET /auth/verify-email redirects harmlessly to the default origin on a bad/expired link', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockRejectedValue(
      new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token'),
    );
    const app = buildApp(auth);

    const res = await request(app).get('/auth/verify-email').query({ token: 'stale.abc' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(DEFAULT_ORIGIN);
  });

  it('GET /auth/verify-email redirects home when the token is missing (boundary failure never shows a raw error, §6.2)', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    const res = await request(app).get('/auth/verify-email');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(DEFAULT_ORIGIN);
  });

  it('POST /auth/confirm-email stays strict: a consumed token is a 400 INVALID_TOKEN envelope', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockRejectedValue(
      new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token'),
    );
    const app = buildApp(auth);

    const res = await request(app).post('/auth/confirm-email').send({ token: 'stale.abc' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('GET /auth/verify-email redirects harmlessly on a malformed query (Zod boundary failure)', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    // Duplicate `token` param → array → z.string() rejects → would otherwise be
    // a raw 400 envelope in the browser tab (§6.2).
    const res = await request(app).get('/auth/verify-email').query('token=a&token=b');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(DEFAULT_ORIGIN);
    expect(auth.confirmEmail).not.toHaveBeenCalled();
  });

  it('GET /auth/verify-email redirects harmlessly once rate limited (no raw 429 to the browser)', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockResolvedValue(SESSION);
    auth.buildVerificationRedirect.mockResolvedValue(`${DEFAULT_ORIGIN}/#access_token=x`);
    const app = buildApp(auth);

    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/auth/verify-email').query({ token: 'verify.abc' });
      expect(res.status).toBe(302);
    }

    const blocked = await request(app).get('/auth/verify-email').query({ token: 'verify.abc' });
    expect(blocked.status).toBe(302);
    expect(blocked.headers.location).toBe(DEFAULT_ORIGIN);
  });
});

describe('auth routes — logout (idempotent 204)', () => {
  it('POST /auth/logout with a refresh token revokes and returns 204', async () => {
    const auth = createFakeAuth();
    auth.resolveUserIdFromRefreshToken.mockResolvedValue(USER_ID);
    auth.logout.mockResolvedValue(undefined);
    const app = buildApp(auth);

    const res = await request(app).post('/auth/logout').send({ refresh_token: 'refresh.abc' });

    expect(res.status).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith(USER_ID);
  });

  it('POST /auth/logout with an access token revokes and returns 204', async () => {
    const auth = createFakeAuth();
    auth.getSession.mockResolvedValue({ user: { id: USER_ID, email: EMAIL }, expires_at: 1 });
    auth.logout.mockResolvedValue(undefined);
    const app = buildApp(auth);

    const res = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${await accessToken()}`)
      .send({});

    expect(res.status).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith(USER_ID);
  });

  it('POST /auth/logout with no credential still returns 204 (idempotent)', async () => {
    const auth = createFakeAuth();
    const app = buildApp(auth);

    const res = await request(app).post('/auth/logout').send({});

    expect(res.status).toBe(204);
    expect(auth.logout).not.toHaveBeenCalled();
  });
});

describe('auth routes — uniform endpoints + request-id correlation', () => {
  it('POST /auth/resend-verification returns 200 with an empty body', async () => {
    const auth = createFakeAuth();
    auth.resendVerification.mockResolvedValue(undefined);
    const app = buildApp(auth);

    const res = await request(app).post('/auth/resend-verification').send({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(auth.resendVerification).toHaveBeenCalledWith(EMAIL);
  });

  it('POST /auth/password-reset/request and POST /auth/password-reset return 200', async () => {
    const auth = createFakeAuth();
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.resetPassword.mockResolvedValue(undefined);
    const app = buildApp(auth);

    const first = await request(app).post('/auth/password-reset/request').send({ email: EMAIL });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/auth/password-reset')
      .send({ token: 'reset.abc', newPassword: 'newpassword1' });
    expect(second.status).toBe(200);
    expect(auth.resetPassword).toHaveBeenCalledWith('reset.abc', 'newpassword1');
  });

  it('echoes the minted x-request-id on an auth error response', async () => {
    const auth = createFakeAuth();
    auth.login.mockRejectedValue(
      new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password'),
    );
    const app = buildApp(auth);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL, password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('auth routes — per-IP rate limiting', () => {
  it('allows 5 logins/min then answers 429 RATE_LIMITED with Retry-After', async () => {
    const auth = createFakeAuth();
    auth.login.mockResolvedValue(SESSION);
    const app = buildApp(auth);

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: EMAIL, password: 'password123' });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app)
      .post('/auth/login')
      .send({ email: EMAIL, password: 'password123' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(auth.login).toHaveBeenCalledTimes(5); // the 6th never reached the service
  });

  it('rate limits resend-verification to 5/min per IP', async () => {
    const auth = createFakeAuth();
    auth.resendVerification.mockResolvedValue(undefined);
    const app = buildApp(auth);

    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/auth/resend-verification').send({ email: EMAIL });
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post('/auth/resend-verification').send({ email: EMAIL });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});
