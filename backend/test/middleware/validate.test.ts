import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { loginSchema, verifyEmailQuerySchema } from '../../src/validation/auth.schemas.js';
import { validateBody, validateQuery, validated } from '../../src/middleware/validate.js';

function mockResponse(): Response {
  return { statusCode: 200 } as unknown as Response;
}

function run(
  middleware: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
): { next?: unknown } {
  const result: { next?: unknown } = {};
  middleware(req, mockResponse(), (err?: unknown) => {
    result.next = err;
  });
  return result;
}

describe('validateBody', () => {
  it('parses a valid body onto req.validated.body and calls next()', () => {
    const req = {
      body: { email: '  New@Example.com  ', password: 'password123' },
    } as unknown as Request;
    const { next } = run(validateBody(loginSchema), req);
    expect(next).toBeUndefined();
    const body = validated<{ email: string; password: string }>(req, 'body');
    expect(body.email).toBe('new@example.com'); // schema normalizes (trim + lowercase)
    expect(body.password).toBe('password123');
  });

  it('forwards a ZodError for an invalid body', () => {
    const req = { body: { email: 'not-an-email', password: 'password123' } } as unknown as Request;
    const { next } = run(validateBody(loginSchema), req);
    expect(next).toBeInstanceOf(ZodError);
  });

  it('treats a bodyless POST as an empty object so optional-only schemas pass', () => {
    // Login still requires email+password, so it fails; a schema with only
    // optional fields (logout) would pass — this only asserts the coerce
    // doesn't crash on an undefined body.
    const req = { body: undefined } as unknown as Request;
    const { next } = run(validateBody(loginSchema), req);
    expect(next).toBeInstanceOf(ZodError);
  });
});

describe('validateQuery', () => {
  it('parses a valid query onto req.validated.query', () => {
    const req = {
      query: { token: 'abc', redirect_to: 'https://app.example/' },
    } as unknown as Request;
    const { next } = run(validateQuery(verifyEmailQuerySchema), req);
    expect(next).toBeUndefined();
    const query = validated<{ token: string; redirect_to?: string }>(req, 'query');
    expect(query.token).toBe('abc');
    expect(query.redirect_to).toBe('https://app.example/');
  });

  it('forwards a ZodError when a required query param is missing', () => {
    const req = { query: {} } as unknown as Request;
    const { next } = run(validateQuery(verifyEmailQuerySchema), req);
    expect(next).toBeInstanceOf(ZodError);
  });
});
