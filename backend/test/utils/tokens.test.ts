import { describe, expect, it } from 'vitest';
import {
  generateOpaqueToken,
  hashToken,
  isValidOpaqueToken,
  tokenOps,
} from '../../src/utils/tokens.js';

describe('generateOpaqueToken', () => {
  it('returns 32 random bytes in canonical base64url', () => {
    const token = generateOpaqueToken();
    expect(token).toBe(isValidOpaqueToken(token) ? token : '');
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('produces distinct values across calls', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('produces a stable 64-char hex digest', () => {
    const hash = hashToken('token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('token')).toBe(hash);
  });

  it('differs for different tokens', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});

describe('isValidOpaqueToken', () => {
  it('accepts a generated token', () => {
    expect(isValidOpaqueToken(generateOpaqueToken())).toBe(true);
  });

  it('rejects tokens that are not canonical 32-byte base64url', () => {
    expect(isValidOpaqueToken('')).toBe(false);
    expect(isValidOpaqueToken('short')).toBe(false);
    // 31 bytes encoded.
    expect(isValidOpaqueToken(Buffer.alloc(31).toString('base64url'))).toBe(false);
    // 33 bytes encoded.
    expect(isValidOpaqueToken(Buffer.alloc(33).toString('base64url'))).toBe(false);
    // Non-base64url characters.
    expect(isValidOpaqueToken(Buffer.alloc(32).toString('base64'))).toBe(false);
    expect(isValidOpaqueToken(Buffer.alloc(32).toString('base64url') + '!')).toBe(false);
  });

  it('rejects non-strings and undefined', () => {
    expect(isValidOpaqueToken(undefined)).toBe(false);
    expect(isValidOpaqueToken(null)).toBe(false);
    expect(isValidOpaqueToken(42)).toBe(false);
    expect(isValidOpaqueToken({})).toBe(false);
  });
});

describe('tokenOps', () => {
  it('binds the pure functions', () => {
    const token = tokenOps.generate();
    expect(tokenOps.isValid(token)).toBe(true);
    expect(tokenOps.hash(token)).toBe(hashToken(token));
  });
});
