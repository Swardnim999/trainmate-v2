import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/utils/errors.js';

const app = createApp();

describe('error envelope', () => {
  it('unknown route → 404 NOT_FOUND envelope', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('404 carries the x-request-id correlation header', async () => {
    const res = await request(app).get('/does-not-exist').set('x-request-id', 'corr-42');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBe('corr-42');
  });

  it('malformed JSON → 400 INVALID_JSON envelope', async () => {
    const res = await request(app)
      .post('/anything')
      .set('content-type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('oversized JSON body → 413 PAYLOAD_TOO_LARGE envelope', async () => {
    const big = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024) });
    const res = await request(app)
      .post('/anything')
      .set('content-type', 'application/json')
      .send(big);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('never leaks stack traces outside development', async () => {
    const res = await request(app).get('/does-not-exist');
    // Test env is NODE_ENV=test → internals must not appear in the envelope.
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
    expect(res.body.error.details).toBeUndefined();
  });

  it('unknown internal error → 500 INTERNAL_SERVER_ERROR with no stack leak', async () => {
    // A real unknown-error path (plain Error, not AppError) — the branch the
    // 404 test above never exercises.
    const throwingApp = express();
    throwingApp.get('/boom', () => {
      throw new Error('kaboom');
    });
    throwingApp.use(errorHandler);

    const res = await request(throwingApp).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(res.body.error.message).toBe('Internal server error');
    // NODE_ENV=test → neither the original message nor internals may leak.
    expect(JSON.stringify(res.body)).not.toContain('kaboom');
    expect(JSON.stringify(res.body)).not.toContain('node_modules');
    expect(res.body.error.details).toBeUndefined();
  });

  it('RATE_LIMITED 429 carries Retry-After so callers back off (§1.3)', async () => {
    // The service login lockout throws AppError(429, RATE_LIMITED) which flows
    // through the error handler (the route limiters answer inline with their own
    // Retry-After) — it must still advertise the block window.
    const throwingApp = express();
    throwingApp.get('/limited', () => {
      throw new AppError(429, 'RATE_LIMITED', 'Too many failed login attempts. Try again later.');
    });
    throwingApp.use(errorHandler);

    const res = await request(throwingApp).get('/limited');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('900'); // LOGIN_BLOCK_MS / 1000
  });
});
