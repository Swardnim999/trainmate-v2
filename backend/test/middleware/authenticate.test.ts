import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../../src/middleware/authenticate.js';
import { AppError } from '../../src/utils/errors.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'user@example.com';

// The middleware verifies with `new JwtService(env.JWT_SECRET)`; tests sign with
// the same pinned secret so real tokens pass and foreign ones fail.
const jwt = new JwtService(env.JWT_SECRET);

function mockResponse(): Response {
  return { statusCode: 200 } as unknown as Response;
}

function callAuthenticate(
  headers: Record<string, unknown>,
): Promise<{ err?: unknown; user?: unknown }> {
  return new Promise((resolve) => {
    const req = { headers } as unknown as Request;
    const next: NextFunction = (err?: unknown) => resolve({ err, user: req.user });
    void authenticate(req, mockResponse(), next);
  });
}

function capture(err?: unknown): AppError {
  if (!(err instanceof AppError)) throw new Error('expected an AppError, got ' + String(err));
  return err;
}

describe('authenticate (Bearer access-token auth)', () => {
  it('rejects a missing Authorization header with 401 AUTH_REQUIRED', async () => {
    const { err } = await callAuthenticate({});
    expect(capture(err).statusCode).toBe(401);
    expect(capture(err).code).toBe('AUTH_REQUIRED');
  });

  it('rejects a duplicate Authorization header (array) with 401 AUTH_REQUIRED', async () => {
    const { err } = await callAuthenticate({ authorization: ['Bearer a.b.c', 'Bearer d.e.f'] });
    expect(capture(err).code).toBe('AUTH_REQUIRED');
  });

  it('rejects a non-Bearer scheme with 401 AUTH_REQUIRED', async () => {
    const { err } = await callAuthenticate({ authorization: 'Basic dXNlcjpwYXNz' });
    expect(capture(err).code).toBe('AUTH_REQUIRED');
  });

  it('attaches the verified identity to req.user and calls next() with no error', async () => {
    const token = await jwt.sign({ id: USER_ID, email: EMAIL }, new Date(), 900);
    const { err, user } = await callAuthenticate({ authorization: `Bearer ${token}` });
    expect(err).toBeUndefined();
    expect(user).toEqual({ id: USER_ID, email: EMAIL });
  });

  it('rejects an expired token with 401 AUTH_TOKEN_EXPIRED', async () => {
    // Issued 200s ago with a 60s lifetime → exp is 140s in the past, beyond the
    // 30s clock skew.
    const token = await jwt.sign({ id: USER_ID, email: EMAIL }, new Date(Date.now() - 200_000), 60);
    const { err } = await callAuthenticate({ authorization: `Bearer ${token}` });
    expect(capture(err).statusCode).toBe(401);
    expect(capture(err).code).toBe('AUTH_TOKEN_EXPIRED');
  });

  it('rejects a token signed with a different secret with 401 AUTH_INVALID_TOKEN', async () => {
    const foreign = new JwtService('a-different-secret-that-is-long-enough-0123456789');
    const token = await foreign.sign({ id: USER_ID, email: EMAIL }, new Date(), 900);
    const { err } = await callAuthenticate({ authorization: `Bearer ${token}` });
    expect(capture(err).code).toBe('AUTH_INVALID_TOKEN');
  });
});
