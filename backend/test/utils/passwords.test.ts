import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import { BCRYPT_COST } from '../../src/config/constants.js';
import {
  BcryptPasswordHasher,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from '../../src/utils/passwords.js';

const PASSWORD = 'correct horse battery staple';

describe('hashPassword / verifyPassword', () => {
  it('hashes at the locked bcrypt cost (D-A11)', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$2')).toBe(true);
    expect(bcrypt.getRounds(hash)).toBe(BCRYPT_COST);
  });

  it('round-trips the correct password', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword(PASSWORD, hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword(PASSWORD);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });

  it('verifies carried-over GoTrue $2a$ hashes (Supabase migration requirement)', async () => {
    const hash = await hashPassword(PASSWORD);
    // GoTrue stored `$2a$`-prefixed hashes; bcryptjs emits the same bcrypt
    // algorithm under `$2b$`. The prefixes differ only in version tag, so a
    // stored `$2a$` hash must verify here.
    const gotrueStyle = `$2a$${hash.slice(4)}`;
    await expect(verifyPassword(PASSWORD, gotrueStyle)).resolves.toBe(true);
  });

  it('distinguishes distinct passwords even when the prefix is forced', async () => {
    const hash = await hashPassword(PASSWORD);
    const gotrueStyle = `$2a$${hash.slice(4)}`;
    await expect(verifyPassword('staple battery horse correct', gotrueStyle)).resolves.toBe(false);
  });
});

describe('getDummyPasswordHash', () => {
  it('returns a stable, valid bcrypt hash at cost 12', () => {
    const first = getDummyPasswordHash();
    const second = getDummyPasswordHash();
    expect(first).toBe(second);
    expect(bcrypt.getRounds(first)).toBe(BCRYPT_COST);
  });

  it('never matches any real password (timing-equalization target only)', async () => {
    await expect(verifyPassword('anything', getDummyPasswordHash())).resolves.toBe(false);
    await expect(verifyPassword(PASSWORD, getDummyPasswordHash())).resolves.toBe(false);
  });
});

describe('BcryptPasswordHasher', () => {
  it('delegates hash/verify/dummyHash to the pure functions', async () => {
    const hasher = new BcryptPasswordHasher();
    const hash = await hasher.hash(PASSWORD);
    await expect(hasher.verify(PASSWORD, hash)).resolves.toBe(true);
    expect(hasher.dummyHash()).toBe(getDummyPasswordHash());
  });
});
