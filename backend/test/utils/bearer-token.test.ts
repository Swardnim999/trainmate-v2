import { describe, expect, it } from 'vitest';
import { extractBearerToken } from '../../src/utils/bearer-token.js';

describe('extractBearerToken', () => {
  it('returns the token for a well-formed Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('tolerates surrounding whitespace and multiple separator spaces', () => {
    expect(extractBearerToken('  Bearer   abc.def  ')).toBe('abc.def');
    expect(extractBearerToken('Bearer\tabc')).toBe('abc');
  });

  it('returns null for a missing header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for a header Node collapsed from duplicates (an array)', () => {
    expect(extractBearerToken(['Bearer a.b', 'Bearer c.d'])).toBeNull();
  });

  it('returns null for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('bearer abc')).toBe('abc'); // scheme is case-insensitive per RFC 6750
    expect(extractBearerToken('Token abc')).toBeNull();
  });

  it('returns null for a malformed or empty token', () => {
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken('Bearer\t')).toBeNull();
  });
});
