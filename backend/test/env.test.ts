import { describe, expect, it } from 'vitest';
import { env, loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults when nothing is provided', () => {
    const e = loadEnv({});
    expect(e.NODE_ENV).toBe('development');
    expect(e.HOST).toBe('0.0.0.0');
    expect(e.PORT).toBe(3000);
    expect(e.LOG_LEVEL).toBe('info');
    expect(e.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(e.DATABASE_URL).toBeUndefined();
  });

  it('coerces a numeric PORT and validates its range', () => {
    expect(loadEnv({ PORT: '8080' }).PORT).toBe(8080);
    expect(() => loadEnv({ PORT: 'not-a-number' })).toThrow();
    expect(() => loadEnv({ PORT: '70000' })).toThrow();
    expect(() => loadEnv({ PORT: '0' })).toThrow();
  });

  it('rejects an invalid LOG_LEVEL', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'verbose' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow();
  });

  it('accepts a valid postgres DATABASE_URL', () => {
    const e = loadEnv({
      DATABASE_URL: 'postgresql://trainmate:trainmate_dev@localhost:5432/trainmate',
    });
    expect(e.DATABASE_URL).toMatch(/^postgresql:/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'not a url' })).toThrow();
  });

  it('rejects a non-postgres DATABASE_URL scheme', () => {
    expect(() => loadEnv({ DATABASE_URL: 'http://example.com/db' })).toThrow();
    expect(() => loadEnv({ DATABASE_URL: 'mysql://u:p@host:3306/db' })).toThrow();
  });

  it('accepts a libpq multi-host DATABASE_URL', () => {
    const e = loadEnv({ DATABASE_URL: 'postgresql://h1:5432,h2:5432/trainmate' });
    expect(e.DATABASE_URL).toBe('postgresql://h1:5432,h2:5432/trainmate');
  });

  it('reports every offending variable in one error', () => {
    expect(() => loadEnv({ LOG_LEVEL: 'bogus', PORT: 'x' })).toThrow(/LOG_LEVEL/);
    expect(() => loadEnv({ LOG_LEVEL: 'bogus', PORT: 'x' })).toThrow(/PORT/);
  });
});

describe('env singleton', () => {
  it('is a typed, valid config', () => {
    // Under vitest, NODE_ENV is pinned to 'test'.
    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('silent');
  });
});
