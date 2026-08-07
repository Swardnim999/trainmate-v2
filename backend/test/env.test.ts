import { describe, expect, it } from 'vitest';
import { env, loadEnv } from '../src/config/env.js';

// JWT_SECRET became required in Sprint 2B M3 (Auth-Design §4.4 / D-A13), so every
// loadEnv call must supply one.
const JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';

describe('loadEnv', () => {
  it('applies defaults when only the required JWT_SECRET is provided', () => {
    const e = loadEnv({ JWT_SECRET });
    expect(e.NODE_ENV).toBe('development');
    expect(e.HOST).toBe('0.0.0.0');
    expect(e.PORT).toBe(3000);
    expect(e.LOG_LEVEL).toBe('info');
    expect(e.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(e.JWT_SECRET).toBe(JWT_SECRET);
    expect(e.AUTH_ALLOWED_REDIRECT_ORIGINS).toBe('');
    expect(e.API_PUBLIC_ORIGIN).toBe('http://localhost:3000');
    expect(e.DATABASE_URL).toBeUndefined();
  });

  it('requires JWT_SECRET to be present and at least 32 characters', () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
    expect(() => loadEnv({ JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('coerces a numeric PORT and validates its range', () => {
    expect(loadEnv({ JWT_SECRET, PORT: '8080' }).PORT).toBe(8080);
    expect(() => loadEnv({ JWT_SECRET, PORT: 'not-a-number' })).toThrow();
    expect(() => loadEnv({ JWT_SECRET, PORT: '70000' })).toThrow();
    expect(() => loadEnv({ JWT_SECRET, PORT: '0' })).toThrow();
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadEnv({ JWT_SECRET, LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ JWT_SECRET, NODE_ENV: 'staging' })).toThrow();
  });

  it('accepts a valid postgres DATABASE_URL', () => {
    const e = loadEnv({
      JWT_SECRET,
      DATABASE_URL: 'postgresql://trainmate:trainmate_dev@localhost:5432/trainmate',
    });
    expect(e.DATABASE_URL).toMatch(/^postgresql:/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => loadEnv({ JWT_SECRET, DATABASE_URL: 'not a url' })).toThrow();
  });

  it('rejects a non-postgres DATABASE_URL scheme', () => {
    expect(() => loadEnv({ JWT_SECRET, DATABASE_URL: 'http://example.com/db' })).toThrow();
    expect(() => loadEnv({ JWT_SECRET, DATABASE_URL: 'mysql://u:p@host:3306/db' })).toThrow();
  });

  it('accepts a libpq multi-host DATABASE_URL', () => {
    const e = loadEnv({
      JWT_SECRET,
      DATABASE_URL: 'postgresql://h1:5432,h2:5432/trainmate',
    });
    expect(e.DATABASE_URL).toBe('postgresql://h1:5432,h2:5432/trainmate');
  });

  it('reports every offending variable in one error', () => {
    expect(() => loadEnv({ JWT_SECRET, LOG_LEVEL: 'bogus', PORT: 'x' })).toThrow(/LOG_LEVEL/);
    expect(() => loadEnv({ JWT_SECRET, LOG_LEVEL: 'bogus', PORT: 'x' })).toThrow(/PORT/);
  });
});

describe('env singleton', () => {
  it('is a typed, valid config', () => {
    // Under vitest, NODE_ENV is pinned to 'test' and JWT_SECRET is supplied.
    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('silent');
    expect(env.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });
});
