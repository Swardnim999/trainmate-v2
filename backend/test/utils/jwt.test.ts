import { describe, expect, it } from 'vitest';
import { SignJWT, UnsecuredJWT } from 'jose';
import { JwtService } from '../../src/utils/jwt.js';

const SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
const OTHER_SECRET = 'other-jwt-secret-0123456789abcdef0123456789abcdef';
const KEY = new TextEncoder().encode(SECRET);

const USER_ID = '00000000-0000-0000-0000-000000000001';
const USER = { id: USER_ID, email: 'a@b.c' };
const TTL = 900;

// jose validates `exp`/`nbf` against the real clock, so anchor all tokens to
// the moment the test runs rather than a fixed timestamp.
const NOW_SECONDS = Math.floor(Date.now() / 1000);

const service = new JwtService(SECRET);

/** Crafts an arbitrary HS256 JWT signed with (default) the service secret. */
async function craft(
  claims: Record<string, unknown>,
  options: { sub?: string; exp?: number; secret?: Uint8Array } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(NOW_SECONDS)
    .setExpirationTime(options.exp ?? NOW_SECONDS + TTL);
  if (options.sub) jwt.setSubject(options.sub);
  return jwt.sign(options.secret ?? KEY);
}

function assertAppError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({ statusCode: 401, code });
}

describe('JwtService.sign', () => {
  it('produces a HS256 JWT that round-trips through verify', async () => {
    const token = await service.sign(USER, new Date(NOW_SECONDS * 1000), TTL);
    await expect(service.verify(token)).resolves.toMatchObject({
      sub: USER_ID,
      email: 'a@b.c',
    });
  });

  it('sets exp to now + ttl in epoch seconds', async () => {
    const token = await service.sign(USER, new Date(NOW_SECONDS * 1000), TTL);
    const { exp } = await service.verify(token);
    expect(exp).toBe(NOW_SECONDS + TTL);
  });
});

describe('JwtService.verify', () => {
  it('rejects a token signed with a different secret', async () => {
    const token = await service.sign(USER, new Date(NOW_SECONDS * 1000), TTL);
    const foreign = new JwtService(OTHER_SECRET);
    await assertAppError(foreign.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects an expired token (exp well in the past)', async () => {
    const token = await craft(
      { email: 'a@b.c', type: 'access' },
      { sub: USER_ID, exp: NOW_SECONDS - 3600 },
    );
    await assertAppError(service.verify(token), 'AUTH_TOKEN_EXPIRED');
  });

  it('accepts a token expiring just inside the clock-skew window', async () => {
    const token = await craft(
      { email: 'a@b.c', type: 'access' },
      { sub: USER_ID, exp: NOW_SECONDS - 20 }, // 20s past, within 30s skew
    );
    await expect(service.verify(token)).resolves.toMatchObject({ sub: USER_ID });
  });

  it('rejects a token expiring just outside the clock-skew window', async () => {
    const token = await craft(
      { email: 'a@b.c', type: 'access' },
      { sub: USER_ID, exp: NOW_SECONDS - 60 }, // 60s past, beyond 30s skew
    );
    await assertAppError(service.verify(token), 'AUTH_TOKEN_EXPIRED');
  });

  it('rejects an alg: none (unsigned) token', async () => {
    const token = new UnsecuredJWT({ email: 'a@b.c', type: 'access', sub: USER_ID })
      .setExpirationTime(NOW_SECONDS + TTL)
      .encode();
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects a token whose type claim is not "access"', async () => {
    const token = await craft({ email: 'a@b.c', type: 'refresh' }, { sub: USER_ID });
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects a token with no type claim', async () => {
    const token = await craft({ email: 'a@b.c' }, { sub: USER_ID });
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects a token whose sub is not a UUID', async () => {
    const token = await craft({ email: 'a@b.c', type: 'access' }, { sub: 'not-a-uuid' });
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects a token with a non-string email', async () => {
    const token = await craft({ email: 42, type: 'access' }, { sub: USER_ID });
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects a token missing the sub claim entirely', async () => {
    const token = await craft({ email: 'a@b.c', type: 'access' });
    await assertAppError(service.verify(token), 'AUTH_INVALID_TOKEN');
  });

  it('rejects garbage that is not a JWT', async () => {
    await assertAppError(service.verify('not.a.jwt'), 'AUTH_INVALID_TOKEN');
  });
});

describe('JwtService constructor', () => {
  it('requires a secret of at least 32 characters', () => {
    expect(() => new JwtService('')).toThrow(/JWT_SECRET/);
    expect(() => new JwtService('short')).toThrow(/JWT_SECRET/);
  });
});
