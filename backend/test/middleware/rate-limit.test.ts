import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter } from '../../src/middleware/rate-limit.js';

function mockResponse(): Response {
  return { statusCode: 200 } as unknown as Response;
}

describe('createRateLimiter skeleton (Phase 3 stub)', () => {
  it('is a pass-through no-op until rate limiting is wired', () => {
    const limiter = createRateLimiter();
    let called = false;
    const next: NextFunction = () => {
      called = true;
    };

    limiter({} as Request, mockResponse(), next);

    expect(called).toBe(true);
  });
});
