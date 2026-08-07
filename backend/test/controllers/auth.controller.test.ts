import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { AuthController } from '../../src/controllers/auth.controller.js';
import type { AuthService, Session } from '../../src/services/auth.service.js';
import { AppError } from '../../src/utils/errors.js';

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

/** A fake AuthService: only the methods a controller touches, all `vi.fn()`. */
function createFakeAuth(): Record<string, ReturnType<typeof vi.fn>> {
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

function createController(auth: Record<string, ReturnType<typeof vi.fn>>): AuthController {
  return new AuthController({
    auth: auth as unknown as AuthService,
    defaultRedirectOrigin: DEFAULT_ORIGIN,
  });
}

function mockResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    end: vi.fn(),
    redirect: vi.fn(),
  } as unknown as Response;
}

function mockRequest(
  overrides: { body?: unknown; query?: unknown; headers?: Record<string, string> } = {},
): Request {
  return {
    validated: { body: overrides.body, query: overrides.query },
    headers: overrides.headers ?? {},
  } as unknown as Request;
}

describe('AuthController', () => {
  it('register: passes the validated input and returns 200 with the service result', async () => {
    const auth = createFakeAuth();
    auth.register.mockResolvedValue({
      user: { id: USER_ID, email: EMAIL },
      confirmationRequired: true,
    });
    const controller = createController(auth);
    const res = mockResponse();

    await controller.register(
      mockRequest({ body: { email: EMAIL, password: 'password123' } }),
      res,
    );

    expect(auth.register).toHaveBeenCalledWith({ email: EMAIL, password: 'password123' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      user: { id: USER_ID, email: EMAIL },
      confirmationRequired: true,
    });
  });

  it('login: returns 200 with the session', async () => {
    const auth = createFakeAuth();
    auth.login.mockResolvedValue(SESSION);
    const controller = createController(auth);
    const res = mockResponse();

    await controller.login(mockRequest({ body: { email: EMAIL, password: 'password123' } }), res);

    expect(auth.login).toHaveBeenCalledWith({ email: EMAIL, password: 'password123' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(SESSION);
  });

  it('refresh: returns 200 with the rotated session', async () => {
    const auth = createFakeAuth();
    auth.refresh.mockResolvedValue(SESSION);
    const controller = createController(auth);
    const res = mockResponse();

    await controller.refresh(mockRequest({ body: { refresh_token: 'refresh.old' } }), res);

    expect(auth.refresh).toHaveBeenCalledWith('refresh.old');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('confirmEmail: returns 200 with the session', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockResolvedValue(SESSION);
    const controller = createController(auth);
    const res = mockResponse();

    await controller.confirmEmail(mockRequest({ body: { token: 'verify.abc' } }), res);

    expect(auth.confirmEmail).toHaveBeenCalledWith('verify.abc');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(SESSION);
  });

  it('resendVerification / requestPasswordReset / resetPassword: return 200 with an empty body', async () => {
    const auth = createFakeAuth();
    auth.resendVerification.mockResolvedValue(undefined);
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.resetPassword.mockResolvedValue(undefined);
    const controller = createController(auth);
    const res = mockResponse();

    await controller.resendVerification(mockRequest({ body: { email: EMAIL } }), res);
    expect(auth.resendVerification).toHaveBeenCalledWith(EMAIL);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({});

    await controller.requestPasswordReset(mockRequest({ body: { email: EMAIL } }), res);
    expect(auth.requestPasswordReset).toHaveBeenCalledWith(EMAIL);

    await controller.resetPassword(
      mockRequest({ body: { token: 'reset.abc', newPassword: 'newpassword1' } }),
      res,
    );
    expect(auth.resetPassword).toHaveBeenCalledWith('reset.abc', 'newpassword1');
  });

  it('getSession: re-extracts the bearer token and returns 200 with user + expiry', async () => {
    const auth = createFakeAuth();
    auth.getSession.mockResolvedValue({
      user: { id: USER_ID, email: EMAIL },
      expires_at: 1_700_000_000,
    });
    const controller = createController(auth);
    const res = mockResponse();

    await controller.getSession(
      mockRequest({ headers: { authorization: 'Bearer access.abc' } }),
      res,
    );

    expect(auth.getSession).toHaveBeenCalledWith('access.abc');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      user: { id: USER_ID, email: EMAIL },
      expires_at: 1_700_000_000,
    });
  });

  it('logout with a refresh token resolves the user via the service and returns 204', async () => {
    const auth = createFakeAuth();
    auth.resolveUserIdFromRefreshToken.mockResolvedValue(USER_ID);
    auth.logout.mockResolvedValue(undefined);
    const controller = createController(auth);
    const res = mockResponse();

    await controller.logout(mockRequest({ body: { refresh_token: 'refresh.abc' } }), res);

    expect(auth.resolveUserIdFromRefreshToken).toHaveBeenCalledWith('refresh.abc');
    expect(auth.logout).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });

  it('logout with only an access token resolves via getSession and returns 204', async () => {
    const auth = createFakeAuth();
    auth.getSession.mockResolvedValue({ user: { id: USER_ID, email: EMAIL }, expires_at: 1 });
    const controller = createController(auth);
    const res = mockResponse();

    await controller.logout(mockRequest({ headers: { authorization: 'Bearer access.abc' } }), res);

    expect(auth.logout).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('logout with an unverifiable access token still returns 204 and revokes nothing', async () => {
    const auth = createFakeAuth();
    auth.getSession.mockRejectedValue(
      new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid access token'),
    );
    const controller = createController(auth);
    const res = mockResponse();

    await controller.logout(mockRequest({ headers: { authorization: 'Bearer garbage' } }), res);

    expect(auth.logout).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('logout with no credential returns 204 without calling the service', async () => {
    const auth = createFakeAuth();
    const controller = createController(auth);
    const res = mockResponse();

    await controller.logout(mockRequest({ body: {} }), res);

    expect(auth.resolveUserIdFromRefreshToken).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('verifyEmail: confirms, resolves the redirect target, and returns 302', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockResolvedValue(SESSION);
    auth.buildVerificationRedirect.mockResolvedValue(
      'http://localhost:5173/#access_token=x&token_type=bearer',
    );
    const controller = createController(auth);
    const res = mockResponse();

    await controller.verifyEmail(
      mockRequest({ query: { token: 'verify.abc', redirect_to: 'http://localhost:5173/welcome' } }),
      res,
    );

    expect(auth.confirmEmail).toHaveBeenCalledWith('verify.abc');
    expect(auth.buildVerificationRedirect).toHaveBeenCalledWith(
      'http://localhost:5173/welcome',
      SESSION,
    );
    expect(res.redirect).toHaveBeenCalledWith(
      302,
      'http://localhost:5173/#access_token=x&token_type=bearer',
    );
  });

  it('verifyEmail: a bad/expired link redirects harmlessly to the default origin', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockRejectedValue(
      new AppError(400, 'INVALID_TOKEN', 'Invalid or expired token'),
    );
    const controller = createController(auth);
    const res = mockResponse();

    await controller.verifyEmail(mockRequest({ query: { token: 'stale.abc' } }), res);

    expect(res.redirect).toHaveBeenCalledWith(302, DEFAULT_ORIGIN);
  });

  it('verifyEmail: non-INVALID_TOKEN errors still propagate', async () => {
    const auth = createFakeAuth();
    auth.confirmEmail.mockRejectedValue(new AppError(500, 'INTERNAL', 'boom'));
    const controller = createController(auth);
    const res = mockResponse();

    await expect(
      controller.verifyEmail(mockRequest({ query: { token: 'verify.abc' } }), res),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
