import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createRateLimiter, InMemoryRateLimitStore } from '../../src/middleware/rate-limit.js';
import { logger } from '../../src/utils/logger.js';

// Capture the middleware's security log so the test can assert request-id
// correlation (Auth-Design §14.5) without a live pino stream.
vi.mock('../../src/utils/logger.js', () => ({
  logger: { warn: vi.fn() },
}));

const WINDOW_MS = 10_000;
const LIMIT = 3;

function makeStore(overrides: { maxKeys?: number } = {}): InMemoryRateLimitStore {
  return new InMemoryRateLimitStore(overrides);
}

function mockRequest(overrides: { id?: string; ip?: string; body?: unknown } = {}): Request {
  return {
    id: overrides.id ?? 'req-1',
    ip: overrides.ip ?? '1.2.3.4',
    validated: { body: overrides.body },
  } as unknown as Request;
}

function mockResponse(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    set: vi.fn(),
    redirect: vi.fn(),
  } as unknown as Response;
}

/** The middleware is synchronous (store + logger + res are all sync), so invoking
 * it runs to completion and returns whether `next()` was reached. */
function callLimiter(
  limiter: (req: Request, res: Response, next: NextFunction) => void,
  req: Request,
  res: Response,
): boolean {
  let passed = false;
  limiter(req, res, () => {
    passed = true;
  });
  return passed;
}

beforeEach(() => {
  vi.mocked(logger.warn).mockClear();
});

describe('InMemoryRateLimitStore (sliding window)', () => {
  it('allows requests up to the limit inside the window', () => {
    const store = makeStore();
    expect(store.consume('k', WINDOW_MS, 1_000, LIMIT).allowed).toBe(true);
    expect(store.consume('k', WINDOW_MS, 2_000, LIMIT).allowed).toBe(true);
    expect(store.consume('k', WINDOW_MS, 3_000, LIMIT).allowed).toBe(true);
  });

  it('rejects once the limit is exceeded and reports a retry delay', () => {
    const store = makeStore();
    store.consume('k', WINDOW_MS, 1_000, LIMIT);
    store.consume('k', WINDOW_MS, 2_000, LIMIT);
    store.consume('k', WINDOW_MS, 3_000, LIMIT);
    const result = store.consume('k', WINDOW_MS, 4_000, LIMIT);
    expect(result.allowed).toBe(false);
    // Oldest in-window request (t=1000) leaves the window in 7s (t=4000 + 7s = 11000).
    expect(result.retryAfterSeconds).toBe(7);
  });

  it('re-allows once requests slide out of the window', () => {
    const store = makeStore();
    store.consume('k', WINDOW_MS, 1_000, LIMIT);
    store.consume('k', WINDOW_MS, 2_000, LIMIT);
    store.consume('k', WINDOW_MS, 3_000, LIMIT);
    // By t=12000 the window is [2000, 12000]: t=1000 and t=2000 have aged out.
    expect(store.consume('k', WINDOW_MS, 12_000, LIMIT).allowed).toBe(true);
  });

  it('keeps counts isolated per key', () => {
    const store = makeStore();
    for (let i = 0; i < LIMIT + 1; i++) store.consume('a', WINDOW_MS, 1_000 + i * 100, LIMIT);
    expect(store.consume('b', WINDOW_MS, 1_000, LIMIT).allowed).toBe(true);
  });

  it('reset() drops a key', () => {
    const store = makeStore();
    store.consume('k', WINDOW_MS, 1_000, LIMIT);
    store.reset('k');
    expect(store.consume('k', WINDOW_MS, 2_000, LIMIT).allowed).toBe(true);
  });

  it('bounds the number of tracked keys once the cap is reached', () => {
    const store = makeStore({ maxKeys: 2 });
    store.consume('a', WINDOW_MS, 1_000, LIMIT);
    store.consume('b', WINDOW_MS, 2_000, LIMIT);
    store.consume('c', WINDOW_MS, 3_000, LIMIT); // evicts the stale-est (a)
    store.consume('d', WINDOW_MS, 4_000, LIMIT); // evicts b
    // Fresh buckets for a/c now; the evicted entries are gone.
    expect(store.consume('a', WINDOW_MS, 5_000, LIMIT).allowed).toBe(true);
    expect(store.consume('c', WINDOW_MS, 6_000, LIMIT).allowed).toBe(true);
  });

  it('evicts the stale-est bucket (oldest most-recent request), not merely oldest-inserted', () => {
    const store = makeStore({ maxKeys: 2 });
    store.consume('a', WINDOW_MS, 1_000, LIMIT);
    store.consume('b', WINDOW_MS, 2_000, LIMIT);
    store.consume('a', WINDOW_MS, 3_000, LIMIT); // a re-used → more recent than b
    store.consume('c', WINDOW_MS, 4_000, LIMIT); // must evict b (stale-est), not a

    // Only re-consume a (already-present keys never trigger eviction, so this
    // proves a's bucket survived the eviction): two in-window requests remain,
    // so the third fills it and the fourth is blocked.
    expect(store.consume('a', WINDOW_MS, 5_000, LIMIT).allowed).toBe(true);
    expect(store.consume('a', WINDOW_MS, 6_000, LIMIT).allowed).toBe(false);
  });
});

describe('createRateLimiter middleware', () => {
  it('calls next() while under the limit', async () => {
    const limiter = createRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      keyGenerator: () => 'login:ip:1.2.3.4',
      store: makeStore(),
      now: () => new Date(1_000),
    });
    const res = mockResponse();
    expect(callLimiter(limiter, mockRequest(), res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 429 RATE_LIMITED with Retry-After and a request-id log once over the limit', async () => {
    const store = makeStore();
    const limiter = createRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      keyGenerator: (req) => `login:ip:${req.ip}`,
      store,
      now: () => new Date(1_000),
    });
    const req = mockRequest({ id: 'rid-123', ip: '1.2.3.4' });
    const res = mockResponse();

    for (let i = 0; i < LIMIT; i++) {
      expect(callLimiter(limiter, req, res)).toBe(true);
    }
    const blocked = callLimiter(limiter, req, res);
    expect(blocked).toBe(false);

    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      {
        requestId: 'rid-123',
        keyNamespace: 'login:ip',
        keyDigest: expect.any(String),
        limit: LIMIT,
        windowMs: WINDOW_MS,
      },
      'auth route rate limit exceeded',
    );
  });

  it('buckets per-email addresses separately (email-key namespacing)', async () => {
    const limiter = createRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      keyGenerator: (req) => {
        const email = (req.validated?.body as { email?: string } | undefined)?.email;
        return `login:email:${email ?? ''}`;
      },
      store: makeStore(),
      now: () => new Date(1_000),
      namespace: 'login:email',
    });

    const alice = mockRequest({ body: { email: 'alice@example.com' } });
    for (let i = 0; i < LIMIT; i++) {
      expect(callLimiter(limiter, alice, mockResponse())).toBe(true);
    }
    expect(callLimiter(limiter, alice, mockResponse())).toBe(false);

    const bob = mockRequest({ body: { email: 'bob@example.com' } });
    expect(callLimiter(limiter, bob, mockResponse())).toBe(true);
  });

  it('logs no PII on a blocked email key (Auth-Design §14.5)', () => {
    const limiter = createRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      keyGenerator: (req) => {
        const email = (req.validated?.body as { email?: string } | undefined)?.email;
        return `login:email:${email ?? ''}`;
      },
      store: makeStore(),
      now: () => new Date(1_000),
      namespace: 'login:email',
    });
    const req = mockRequest({ id: 'rid-email', body: { email: 'victim@example.com' } });
    for (let i = 0; i < LIMIT; i++) callLimiter(limiter, req, mockResponse());
    expect(callLimiter(limiter, req, mockResponse())).toBe(false);

    const payload = vi.mocked(logger.warn).mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(payload.requestId).toBe('rid-email');
    expect(payload.keyNamespace).toBe('login:email');
    expect(String(payload.keyDigest)).toMatch(/^[0-9a-f]{16}$/);
    // The address must never appear in the structured log line.
    expect(JSON.stringify(payload)).not.toContain('victim@example.com');
  });

  it('onBlocked replaces the default 429 JSON (browser-facing routes, §6.2)', () => {
    const limiter = createRateLimiter({
      limit: LIMIT,
      windowMs: WINDOW_MS,
      keyGenerator: () => 'verify:ip:9.9.9.9',
      store: makeStore(),
      now: () => new Date(1_000),
      onBlocked: (_req, res) => res.redirect(302, 'http://localhost:5173'),
    });
    const res = mockResponse();
    for (let i = 0; i < LIMIT; i++) callLimiter(limiter, mockRequest(), res);
    const blocked = callLimiter(limiter, mockRequest(), res);

    expect(blocked).toBe(false);
    expect(res.status).not.toHaveBeenCalledWith(429);
    expect(res.redirect).toHaveBeenCalledWith(302, 'http://localhost:5173');
  });
});
