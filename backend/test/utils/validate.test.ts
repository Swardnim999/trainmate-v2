import { describe, expect, it } from 'vitest';
import {
  assertEmailValid,
  assertPasswordValid,
  isValidEmail,
  normalizeEmail,
} from '../../src/utils/validate.js';

// Control-char inputs are built from code points (String.fromCharCode) so the
// source file stays free of literal control bytes / escape-sequence ambiguity.
const NUL = String.fromCharCode(0);
const TAB = String.fromCharCode(9);
const LF = String.fromCharCode(10);
const US = String.fromCharCode(31);
const DEL = String.fromCharCode(127);

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  User@Example.COM  ')).toBe('user@example.com');
  });

  it('returns empty for a non-string input (boundary defense)', () => {
    expect(normalizeEmail(undefined as unknown as string)).toBe('');
    expect(normalizeEmail(null as unknown as string)).toBe('');
    expect(normalizeEmail(42 as unknown as string)).toBe('');
  });
});

describe('isValidEmail', () => {
  it('accepts plain well-formed addresses', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('user.name+tag@example.org')).toBe(true);
  });

  it('rejects structurally invalid addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('missing-at-sign.com')).toBe(false);
    expect(isValidEmail('missing@domain')).toBe(false);
    expect(isValidEmail('two@@at.com')).toBe(false);
    expect(isValidEmail('with space@example.com')).toBe(false);
    expect(isValidEmail(`nul@exa${NUL}mple.com`)).toBe(false);
  });

  it('rejects addresses over 254 characters after normalization', () => {
    const local = 'a'.repeat(246);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

/** Runs `fn`, returning the error it throws (fails the test if none is thrown). */
function capture(fn: () => void): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the function to throw');
}

describe('assertEmailValid', () => {
  it('throws 400 VALIDATION_ERROR for an invalid address', () => {
    expect(capture(() => assertEmailValid('nope'))).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });

  it('does not throw for a valid address', () => {
    expect(() => assertEmailValid(' A@b.c ')).not.toThrow();
  });
});

describe('assertPasswordValid', () => {
  it('accepts a password at the 8-char minimum and the 72-byte ceiling', () => {
    expect(() => assertPasswordValid('12345678')).not.toThrow();
    expect(() => assertPasswordValid('a'.repeat(72))).not.toThrow();
    expect(() => assertPasswordValid('é'.repeat(36))).not.toThrow(); // 72 UTF-8 bytes
  });

  it('rejects a password shorter than 8 characters', () => {
    expect(() => assertPasswordValid('1234567')).toThrow();
    expect(() => assertPasswordValid('')).toThrow();
  });

  it('rejects a password over 72 UTF-8 bytes (bcrypt truncation limit)', () => {
    expect(() => assertPasswordValid('a'.repeat(73))).toThrow();
    expect(() => assertPasswordValid('é'.repeat(37))).toThrow(); // 74 UTF-8 bytes
  });

  it('rejects control characters and NUL', () => {
    expect(() => assertPasswordValid(`pass${NUL}word`)).toThrow();
    expect(() => assertPasswordValid(`pass${TAB}word`)).toThrow();
    expect(() => assertPasswordValid(`pass${LF}word`)).toThrow();
    expect(() => assertPasswordValid(`pass${US}word`)).toThrow();
    expect(() => assertPasswordValid(`pass${DEL}word`)).toThrow();
  });

  it('throws with the locked 400 VALIDATION_ERROR code', () => {
    expect(capture(() => assertPasswordValid('short'))).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
    });
  });
});
