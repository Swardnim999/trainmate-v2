import { describe, expect, it } from 'vitest';
import { generateRequestId, sanitizeRequestId } from '../../src/utils/request-id.js';

describe('sanitizeRequestId', () => {
  it('accepts a sane id', () => {
    expect(sanitizeRequestId('trace-abc_123.456')).toBe('trace-abc_123.456');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeRequestId('  abc-123  ')).toBe('abc-123');
  });

  it('rejects non-strings', () => {
    expect(sanitizeRequestId(undefined)).toBeUndefined();
    expect(sanitizeRequestId(42)).toBeUndefined();
    expect(sanitizeRequestId(null)).toBeUndefined();
  });

  it('rejects empty or too-long ids', () => {
    expect(sanitizeRequestId('')).toBeUndefined();
    expect(sanitizeRequestId('   ')).toBeUndefined();
    expect(sanitizeRequestId('x'.repeat(101))).toBeUndefined();
  });

  it('rejects characters outside the allowlist (no log-injection vector)', () => {
    expect(sanitizeRequestId('bad\ninjection')).toBeUndefined();
    expect(sanitizeRequestId('bad!value')).toBeUndefined();
    expect(sanitizeRequestId('a/b')).toBeUndefined();
    expect(sanitizeRequestId('a b')).toBeUndefined();
  });
});

describe('generateRequestId', () => {
  it('mints UUIDs', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(generateRequestId()).not.toBe(generateRequestId());
  });
});
