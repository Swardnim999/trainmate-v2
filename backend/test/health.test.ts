import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /health', () => {
  it('returns 200 ok with service metadata', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'trainmate-api' });
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);
  });

  it('mints an x-request-id when none is sent', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('honors a sane inbound x-request-id and echoes it back', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'trace-abc-123');
    expect(res.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('ignores a hostile inbound x-request-id and mints its own', async () => {
    // `!` is a legal HTTP header char a client can send, but it is not in the
    // sanitizer allowlist, so the server must reject it and mint a fresh id.
    const res = await request(app).get('/health').set('x-request-id', 'bad!value');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.headers['x-request-id']).not.toBe('bad!value');
  });

  it('does not leak server tech via x-powered-by', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
