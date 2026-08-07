import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { InMemoryRateLimitStore } from '../src/middleware/rate-limit.js';
import type { AuthService, Session } from '../src/services/auth.service.js';

const SESSION: Session = {
  access_token: 'access.abc',
  refresh_token: 'refresh.abc',
  expires_in: 900,
  token_type: 'bearer',
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.com' },
};

function fakeAuth(): Record<string, ReturnType<typeof vi.fn>> {
  return { login: vi.fn().mockResolvedValue(SESSION) };
}

function buildApp(auth: Record<string, ReturnType<typeof vi.fn>>) {
  return createApp({
    auth: auth as unknown as AuthService,
    rateLimitStore: new InMemoryRateLimitStore(),
  });
}

/**
 * Per-IP rate-limit keying under X-Forwarded-For (Auth-Design §16.3 Phase-14).
 * Default TRUST_PROXY_HOPS=0 must keep the socket IP as the key (spoof-safe);
 * with hops configured, the trusted proxy's XFF must drive the key. Each
 * scenario uses a distinct email so the observed behavior isolates the *IP*
 * limiter, not the per-email one.
 */
describe('trust proxy and per-IP rate-limit keying', () => {
  const originalHops = env.TRUST_PROXY_HOPS;

  afterEach(() => {
    env.TRUST_PROXY_HOPS = originalHops;
  });

  it('default (0 hops): a spoofed X-Forwarded-For does not reset the per-IP login bucket', async () => {
    env.TRUST_PROXY_HOPS = 0;
    const app = buildApp(fakeAuth());

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({ email: 'alice@example.com', password: 'password123' });
      expect(res.status).toBe(200);
    }

    // Same socket, a *different* spoofed IP and a different email → still 429,
    // proving the key never moved off the socket address.
    const spoofed = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '2.2.2.2')
      .send({ email: 'bob@example.com', password: 'password123' });

    expect(spoofed.status).toBe(429);
    expect(spoofed.body.error.code).toBe('RATE_LIMITED');
  });

  it('with TRUST_PROXY_HOPS=1 the trusted XFF drives the per-IP key', async () => {
    env.TRUST_PROXY_HOPS = 1;
    const app = buildApp(fakeAuth());

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', '1.1.1.1')
        .send({ email: 'alice@example.com', password: 'password123' });
      expect(res.status).toBe(200);
    }

    // New XFF → new trusted client → a fresh bucket, so the request succeeds.
    const fresh = await request(app)
      .post('/auth/login')
      .set('X-Forwarded-For', '2.2.2.2')
      .send({ email: 'bob@example.com', password: 'password123' });

    expect(fresh.status).toBe(200);
  });
});
