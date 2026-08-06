import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { authenticate } from '../../src/middleware/authenticate.js';
import { AppError } from '../../src/utils/errors.js';

function mockResponse(): Response {
  return { statusCode: 200 } as unknown as Response;
}

describe('authenticate skeleton (Phase 3 stub)', () => {
  it('forwards an AUTH_NOT_IMPLEMENTED 401 AppError', () => {
    let passed: unknown;
    const next: NextFunction = (err?: unknown) => {
      passed = err;
    };

    authenticate({} as Request, mockResponse(), next);

    expect(passed).toBeInstanceOf(AppError);
    const err = passed as AppError;
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('AUTH_NOT_IMPLEMENTED');
  });
});
