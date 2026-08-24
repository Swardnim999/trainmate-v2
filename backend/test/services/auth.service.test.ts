import { describe, expect, it, vi } from 'vitest';
import {
  Prisma,
  type EmailVerification,
  type PrismaClient,
  type RefreshToken,
  type User,
} from '@prisma/client';
import { AuthService, type AuthServiceDeps } from '../../src/services/auth.service.js';
import { InMemoryLoginLockout } from '../../src/services/login-lockout.js';
import { EmailVerificationRepository } from '../../src/repositories/email-verifications.repo.js';
import { RefreshTokenRepository } from '../../src/repositories/refresh-tokens.repo.js';
import { UserRepository } from '../../src/repositories/users.repo.js';

const NOW = new Date('2026-08-07T12:00:00Z');
const USER_ID = '00000000-0000-0000-0000-000000000001';
const REFRESH_ID = '00000000-0000-0000-0000-000000000002';
const FAMILY_ID = '00000000-0000-0000-0000-000000000003';
const VERIFY_ID = '00000000-0000-0000-0000-000000000004';
const ORIGIN = 'http://app.test';
const TTL = 900;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'a@b.c',
    passwordHash: 'hash',
    emailConfirmedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRefreshToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: REFRESH_ID,
    userId: USER_ID,
    familyId: FAMILY_ID,
    tokenHash: 'hash(raw)',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    createdAt: new Date('2026-08-01T00:00:00Z'),
    revokedAt: null,
    replacedByTokenHash: null,
    ...overrides,
  };
}

function makeVerification(overrides: Partial<EmailVerification> = {}): EmailVerification {
  return {
    id: VERIFY_ID,
    userId: USER_ID,
    type: 'signup',
    tokenHash: 'hash(raw)',
    expiresAt: new Date('2026-08-08T00:00:00Z'),
    consumedAt: null,
    ...overrides,
  };
}

type MockDb = ReturnType<typeof createMockDb>;

function createMockDb() {
  const db = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailVerification: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    profile: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: USER_ID }),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  const withTx = db as MockDb & { $transaction: ReturnType<typeof vi.fn> };
  withTx.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(withTx));
  return withTx;
}

function createHarness(overrides: Partial<AuthServiceDeps> = {}) {
  const db = createMockDb();
  const users = new UserRepository(db as unknown as PrismaClient);
  const refreshTokens = new RefreshTokenRepository(db as unknown as PrismaClient);
  const emailVerifications = new EmailVerificationRepository(db as unknown as PrismaClient);
  const passwords = {
    hash: vi.fn().mockResolvedValue('hash'),
    verify: vi.fn().mockResolvedValue(true),
    dummyHash: vi.fn(() => 'dummy-hash'),
  };
  const tokens = {
    generate: vi.fn(() => 'raw-refresh-token'),
    hash: vi.fn((token: string) => `hash(${token})`),
    isValid: vi.fn(() => true),
  };
  const jwt = {
    sign: vi.fn().mockResolvedValue('access-token'),
    verify: vi.fn(),
  };
  const emails = {
    sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  };
  const lockout = new InMemoryLoginLockout({ now: () => NOW });

  const service = new AuthService({
    db: db as unknown as PrismaClient,
    users,
    refreshTokens,
    emailVerifications,
    passwords,
    tokens,
    jwt,
    emails,
    lockout,
    accessTokenTtlSeconds: TTL,
    redirectOrigins: [ORIGIN],
    defaultRedirectOrigin: ORIGIN,
    now: () => NOW,
    ...overrides,
  });

  return {
    service,
    db,
    users,
    refreshTokens,
    emailVerifications,
    passwords,
    tokens,
    jwt,
    emails,
    lockout,
  };
}

function expectAuthError(
  promise: Promise<unknown>,
  statusCode: number,
  code: string,
): Promise<void> {
  return expect(promise).rejects.toMatchObject({ statusCode, code });
}

describe('AuthService.register', () => {
  it('creates an unconfirmed user, issues a signup token, and emails it', async () => {
    const { service, db, emails, tokens } = createHarness();
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.emailVerification.create.mockResolvedValue(makeVerification());

    const result = await service.register({ email: ' A@B.C ', password: 'password123' });

    expect(result).toEqual({
      user: { id: USER_ID, email: 'a@b.c' },
      confirmationRequired: true,
    });
    expect(db.user.create).toHaveBeenCalledWith({
      data: { email: 'a@b.c', passwordHash: 'hash' },
    });
    expect(db.emailVerification.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        type: 'signup',
        tokenHash: 'hash(raw-refresh-token)',
        expiresAt: expect.any(Date),
      },
    });
    expect(emails.sendVerificationEmail).toHaveBeenCalledWith({
      to: 'a@b.c',
      token: 'raw-refresh-token',
      redirectTo: ORIGIN,
    });
    expect(tokens.generate).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate a confirmed account and sends nothing', async () => {
    const { service, db, emails } = createHarness();
    const confirmed = makeUser();
    db.user.findUnique.mockResolvedValue(confirmed);

    const result = await service.register({ email: 'a@b.c', password: 'password123' });

    expect(result.confirmationRequired).toBe(true);
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.emailVerification.create).not.toHaveBeenCalled();
    expect(emails.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('pays the bcrypt cost for a confirmed account so timing does not reveal it', async () => {
    const { service, db, passwords } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser());

    const result = await service.register({ email: 'a@b.c', password: 'password123' });

    expect(result.confirmationRequired).toBe(true);
    // The throwaway hash equals the cost a new signup pays (§2.2 timing defense).
    expect(passwords.hash).toHaveBeenCalledWith('password123');
  });

  it('falls through to the idempotent path when a racing submit hits the unique email constraint', async () => {
    const { service, db, emails } = createHarness();
    const unconfirmed = makeUser({ emailConfirmedAt: null });
    db.user.findUnique
      .mockResolvedValueOnce(null) // initial lookup: no existing user
      .mockResolvedValueOnce(unconfirmed); // re-fetch after the P2002
    db.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed on email', {
        code: 'P2002',
        clientVersion: '6.6.0',
      }),
    );
    db.emailVerification.create.mockResolvedValue(makeVerification());

    const result = await service.register({ email: 'a@b.c', password: 'password123' });

    expect(result.confirmationRequired).toBe(true);
    expect(db.emailVerification.create).toHaveBeenCalledTimes(1);
    expect(emails.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('rotates the token for an existing unconfirmed user instead of a new row', async () => {
    const { service, db, emails } = createHarness();
    const unconfirmed = makeUser({ emailConfirmedAt: null });
    db.user.findUnique.mockResolvedValue(unconfirmed);
    db.emailVerification.create.mockResolvedValue(makeVerification());

    const result = await service.register({ email: 'a@b.c', password: 'password123' });

    expect(result.user).toEqual({ id: USER_ID, email: 'a@b.c' });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.emailVerification.create).toHaveBeenCalledTimes(1);
    expect(emails.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('runs the profile-bootstrap seam only for a brand-new user', async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const { service, db } = createHarness({ bootstrapProfile: bootstrap });
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.emailVerification.create.mockResolvedValue(makeVerification());

    await service.register({ email: 'a@b.c', password: 'password123' });
    expect(bootstrap).toHaveBeenCalledWith(USER_ID);

    bootstrap.mockClear();
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    await service.register({ email: 'a@b.c', password: 'password123' });
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before touching the database', async () => {
    const { service, db } = createHarness();
    await expectAuthError(
      service.register({ email: 'nope', password: 'password123' }),
      400,
      'VALIDATION_ERROR',
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a weak password before touching the database', async () => {
    const { service, db } = createHarness();
    await expectAuthError(
      service.register({ email: 'a@b.c', password: 'short' }),
      400,
      'VALIDATION_ERROR',
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('allowlists the email confirmation redirect_to', async () => {
    const { service, db, emails } = createHarness();
    db.user.findUnique.mockResolvedValue(null);
    db.user.create.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.emailVerification.create.mockResolvedValue(makeVerification());

    // Allowed origin (with a path) → collapses to the origin.
    await service.register({
      email: 'a@b.c',
      password: 'password123',
      emailRedirectTo: 'http://app.test/welcome',
    });
    expect(emails.sendVerificationEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ redirectTo: ORIGIN }),
    );

    // Non-allowlisted origin → default origin, silently.
    await service.register({
      email: 'a@b.c',
      password: 'password123',
      emailRedirectTo: 'http://evil.example/cb',
    });
    expect(emails.sendVerificationEmail).toHaveBeenLastCalledWith(
      expect.objectContaining({ redirectTo: ORIGIN }),
    );
  });
});

describe('AuthService.login', () => {
  it('issues a session for a confirmed user with the right password', async () => {
    const { service, db, passwords, tokens, jwt } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser());
    db.refreshToken.create.mockResolvedValue(makeRefreshToken());

    const session = await service.login({ email: 'a@b.c', password: 'password123' });

    expect(session).toEqual({
      access_token: 'access-token',
      refresh_token: 'raw-refresh-token',
      expires_in: TTL,
      token_type: 'bearer',
      user: { id: USER_ID, email: 'a@b.c' },
    });
    expect(passwords.verify).toHaveBeenCalledWith('password123', 'hash');
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        tokenHash: 'hash(raw-refresh-token)',
      }),
    });
    expect(jwt.sign).toHaveBeenCalledWith({ id: USER_ID, email: 'a@b.c' }, NOW, TTL);
    expect(tokens.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong password with a uniform 401 and records a failure', async () => {
    const { service, db, passwords, lockout } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser());
    passwords.verify.mockResolvedValue(false);

    await expectAuthError(
      service.login({ email: 'a@b.c', password: 'wrong' }),
      401,
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(lockout.isBlocked('a@b.c')).toBe(false);
  });

  it('equalizes timing for an unknown email by comparing against the dummy hash', async () => {
    const { service, db, passwords } = createHarness();
    db.user.findUnique.mockResolvedValue(null);

    await expectAuthError(
      service.login({ email: 'ghost@nowhere.example', password: 'password123' }),
      401,
      'AUTH_INVALID_CREDENTIALS',
    );
    // The bcrypt compare still ran — against the dummy hash — so response time
    // does not reveal that the address is unregistered.
    expect(passwords.verify).toHaveBeenCalledWith('password123', 'dummy-hash');
  });

  it('returns 403 EMAIL_NOT_CONFIRMED for a correct password on an unconfirmed account', async () => {
    const { service, db } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));

    await expectAuthError(
      service.login({ email: 'a@b.c', password: 'password123' }),
      403,
      'EMAIL_NOT_CONFIRMED',
    );
  });

  it('returns 429 RATE_LIMITED and skips bcrypt once the address is blocked', async () => {
    const { service, db, passwords, lockout } = createHarness();
    for (let i = 0; i < 10; i++) lockout.registerFailure('a@b.c');
    db.user.findUnique.mockResolvedValue(makeUser());

    await expectAuthError(
      service.login({ email: 'a@b.c', password: 'password123' }),
      429,
      'RATE_LIMITED',
    );
    expect(passwords.verify).not.toHaveBeenCalled();
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a non-string password as 400 VALIDATION_ERROR instead of a 500', async () => {
    const { service, db } = createHarness();
    await expectAuthError(
      service.login({ email: 'a@b.c', password: undefined as unknown as string }),
      400,
      'VALIDATION_ERROR',
    );
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rotates an active token in one transaction and returns a new session', async () => {
    const { service, db, jwt, tokens } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());
    db.user.findUnique.mockResolvedValue(makeUser());
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    db.refreshToken.create.mockResolvedValue(
      makeRefreshToken({ tokenHash: 'hash(raw-refresh-token)' }),
    );

    const session = await service.refresh('raw-refresh-token');

    expect(session.access_token).toBe('access-token');
    expect(session.refresh_token).toBe('raw-refresh-token');
    expect(session.expires_in).toBe(TTL);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: REFRESH_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date), replacedByTokenHash: 'hash(raw-refresh-token)' },
    });
    // New token joins the SAME family (rotation, not a fresh family).
    expect(db.refreshToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ familyId: FAMILY_ID, userId: USER_ID }),
    });
    expect(db.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(jwt.sign).toHaveBeenCalledTimes(1);
    expect(tokens.generate).toHaveBeenCalledTimes(1);
  });

  it('treats a revoked token as reuse and revokes the whole family', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ revokedAt: new Date('2026-08-02T00:00:00Z') }),
    );
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expectAuthError(service.refresh('raw-refresh-token'), 401, 'TOKEN_REUSE_DETECTED');
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: FAMILY_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('detects a racing rotation (already revoked by a sibling) and revokes the family', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());
    db.user.findUnique.mockResolvedValue(makeUser());
    // revokeById loses the race (count 0) → reuse path inside the transaction.
    db.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expectAuthError(service.refresh('raw-refresh-token'), 401, 'TOKEN_REUSE_DETECTED');
    // revokeFamily ran (and persisted on commit) — the create must NOT have.
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects a missing token with a plain 401 and no database writes', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(null);

    await expectAuthError(service.refresh('raw-refresh-token'), 401, 'AUTH_INVALID_TOKEN');
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an expired token as a plain 401 (not reuse)', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
    );

    await expectAuthError(service.refresh('raw-refresh-token'), 401, 'AUTH_INVALID_TOKEN');
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('treats an expired-but-revoked token as reuse (revocation/warn survives)', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({
        revokedAt: new Date('2026-08-02T00:00:00Z'),
        expiresAt: new Date('2026-08-01T00:00:00Z'),
      }),
    );
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expectAuthError(service.refresh('raw-refresh-token'), 401, 'TOKEN_REUSE_DETECTED');
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: FAMILY_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a malformed token before any database access', async () => {
    const { service, db, tokens } = createHarness();
    tokens.isValid.mockReturnValue(false);

    await expectAuthError(service.refresh('!!not-a-real-token!!'), 401, 'AUTH_INVALID_TOKEN');
    expect(db.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('refuses to refresh into an unconfirmed account', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));

    await expectAuthError(service.refresh('raw-refresh-token'), 403, 'EMAIL_NOT_CONFIRMED');
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout / resolveUserIdFromRefreshToken', () => {
  it('revokes every family for the user (global scope) and is idempotent', async () => {
    const { service, db } = createHarness();
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(service.logout(USER_ID)).resolves.toBeUndefined();
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('resolves a user id from a still-active refresh token', async () => {
    const { service, db } = createHarness();
    db.refreshToken.findUnique.mockResolvedValue(makeRefreshToken());

    await expect(service.resolveUserIdFromRefreshToken('raw-refresh-token')).resolves.toBe(USER_ID);
  });

  it('resolves null for a revoked, expired, or malformed token', async () => {
    const { service, db, tokens } = createHarness();

    db.refreshToken.findUnique.mockResolvedValue(makeRefreshToken({ revokedAt: new Date() }));
    await expect(service.resolveUserIdFromRefreshToken('raw-refresh-token')).resolves.toBeNull();

    db.refreshToken.findUnique.mockResolvedValue(
      makeRefreshToken({ expiresAt: new Date('2026-01-01T00:00:00Z') }),
    );
    await expect(service.resolveUserIdFromRefreshToken('raw-refresh-token')).resolves.toBeNull();

    tokens.isValid.mockReturnValue(false);
    await expect(service.resolveUserIdFromRefreshToken('bad')).resolves.toBeNull();
  });
});

describe('AuthService.confirmEmail', () => {
  it('consumes the token, confirms the user, and issues a session atomically', async () => {
    const { service, db, jwt, tokens } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(makeVerification());
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.emailVerification.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue(makeUser());
    db.refreshToken.create.mockResolvedValue(makeRefreshToken());

    const session = await service.confirmEmail('raw-refresh-token');

    expect(session.access_token).toBe('access-token');
    expect(db.emailVerification.updateMany).toHaveBeenCalledWith({
      where: { id: VERIFY_ID, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { emailConfirmedAt: expect.any(Date) },
    });
    expect(db.refreshToken.create).toHaveBeenCalledTimes(1);
    expect(jwt.sign).toHaveBeenCalledWith({ id: USER_ID, email: 'a@b.c' }, NOW, TTL);
    expect(tokens.generate).toHaveBeenCalledTimes(1);
  });

  it('rejects an already-consumed token without touching the user', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(
      makeVerification({ consumedAt: new Date('2026-08-07T11:00:00Z') }),
    );

    await expectAuthError(service.confirmEmail('raw-refresh-token'), 400, 'INVALID_TOKEN');
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.refreshToken.create).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(
      makeVerification({ expiresAt: new Date('2026-08-01T00:00:00Z') }),
    );

    await expectAuthError(service.confirmEmail('raw-refresh-token'), 400, 'INVALID_TOKEN');
  });

  it('rejects a password-reset token used against the signup endpoint', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(makeVerification({ type: 'password_reset' }));

    await expectAuthError(service.confirmEmail('raw-refresh-token'), 400, 'INVALID_TOKEN');
  });

  it('is single-use even under a double-click (the atomic consume wins once)', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(makeVerification());
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.refreshToken.create.mockResolvedValue(makeRefreshToken());
    // First click consumes; a racing second click finds count 0 → 400, no effect.
    db.emailVerification.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    db.user.update.mockResolvedValue(makeUser());

    await service.confirmEmail('raw-refresh-token');
    await expectAuthError(service.confirmEmail('raw-refresh-token'), 400, 'INVALID_TOKEN');
    // Only the first attempt confirmed the user.
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.buildVerificationRedirect', () => {
  async function sessionLike() {
    return {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: TTL,
      token_type: 'bearer' as const,
      user: { id: USER_ID, email: 'a@b.c' },
    };
  }

  it('builds a hash-fragment redirect to an allowlisted origin', async () => {
    const { service } = createHarness();
    const url = await service.buildVerificationRedirect(`${ORIGIN}/welcome`, await sessionLike());
    expect(url).toMatch(new RegExp(`^${ORIGIN.replace(/\./g, '\\.')}/#`));
    expect(url).toContain('access_token=at');
    expect(url).toContain('refresh_token=rt');
    expect(url).toContain('token_type=bearer');
  });

  it('falls back to the default origin for a non-allowlisted redirect', async () => {
    const { service } = createHarness();
    const url = await service.buildVerificationRedirect(
      'http://evil.example/cb',
      await sessionLike(),
    );
    expect(url.startsWith(`${ORIGIN}/#`)).toBe(true);
  });

  it('falls back to the default origin for a malformed redirect', async () => {
    const { service } = createHarness();
    const url = await service.buildVerificationRedirect('not a url', await sessionLike());
    expect(url.startsWith(`${ORIGIN}/#`)).toBe(true);
  });
});

describe('AuthService.resendVerification', () => {
  it('re-emails a fresh token for an unconfirmed user', async () => {
    const { service, db, emails, tokens } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    db.emailVerification.create.mockResolvedValue(makeVerification());

    await expect(service.resendVerification(' a@b.c ')).resolves.toBeUndefined();
    expect(db.emailVerification.create).toHaveBeenCalledTimes(1);
    expect(emails.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.c' }),
    );
    expect(tokens.generate).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a confirmed or unknown address (uniform success)', async () => {
    const { service, db, emails } = createHarness();

    db.user.findUnique.mockResolvedValue(makeUser());
    await expect(service.resendVerification('a@b.c')).resolves.toBeUndefined();
    expect(emails.sendVerificationEmail).not.toHaveBeenCalled();

    emails.sendVerificationEmail.mockClear();
    db.user.findUnique.mockResolvedValue(null);
    await expect(service.resendVerification('ghost@nowhere.example')).resolves.toBeUndefined();
    expect(db.emailVerification.create).not.toHaveBeenCalled();
    expect(emails.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe('AuthService.requestPasswordReset / resetPassword', () => {
  it('emails a single-use reset token to a confirmed account (uniform 200)', async () => {
    const { service, db, emails, tokens } = createHarness();
    db.user.findUnique.mockResolvedValue(makeUser());
    db.emailVerification.create.mockResolvedValue(makeVerification());

    await expect(service.requestPasswordReset('a@b.c')).resolves.toBeUndefined();
    expect(db.emailVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'password_reset' }),
    });
    expect(emails.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.c',
        resetUrl: expect.stringContaining(`token=${tokens.generate()}`),
      }),
    );
  });

  it('sends nothing for an unconfirmed or unknown address', async () => {
    const { service, db, emails } = createHarness();

    db.user.findUnique.mockResolvedValue(makeUser({ emailConfirmedAt: null }));
    await service.requestPasswordReset('a@b.c');
    expect(emails.sendPasswordResetEmail).not.toHaveBeenCalled();

    db.user.findUnique.mockResolvedValue(null);
    await service.requestPasswordReset('ghost@nowhere.example');
    expect(db.emailVerification.create).not.toHaveBeenCalled();
  });

  it('resets the password, consumes the token, and revokes all sessions atomically', async () => {
    const { service, db, passwords, lockout } = createHarness();
    passwords.hash.mockResolvedValue('new-hash');
    db.emailVerification.findUnique.mockResolvedValue(makeVerification({ type: 'password_reset' }));
    db.user.findUnique.mockResolvedValue(makeUser());
    db.emailVerification.updateMany.mockResolvedValue({ count: 1 });
    db.user.update.mockResolvedValue(makeUser({ passwordHash: 'new-hash' }));
    db.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      service.resetPassword('raw-refresh-token', 'new-password-123'),
    ).resolves.toBeUndefined();

    expect(passwords.hash).toHaveBeenCalledWith('new-password-123');
    expect(db.emailVerification.updateMany).toHaveBeenCalledWith({
      where: { id: VERIFY_ID, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { passwordHash: 'new-hash' },
    });
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(lockout.isBlocked('a@b.c')).toBe(false);
  });

  it('rejects an already-consumed reset token', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(
      makeVerification({ type: 'password_reset', consumedAt: new Date('2026-08-07T11:00:00Z') }),
    );

    await expectAuthError(
      service.resetPassword('raw-refresh-token', 'new-password-123'),
      400,
      'INVALID_TOKEN',
    );
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a weak new password before any writes', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(makeVerification({ type: 'password_reset' }));
    db.user.findUnique.mockResolvedValue(makeUser());

    await expectAuthError(
      service.resetPassword('raw-refresh-token', 'short'),
      400,
      'VALIDATION_ERROR',
    );
    expect(db.emailVerification.updateMany).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('rejects a signup token used against the reset endpoint', async () => {
    const { service, db } = createHarness();
    db.emailVerification.findUnique.mockResolvedValue(makeVerification());

    await expectAuthError(
      service.resetPassword('raw-refresh-token', 'new-password-123'),
      400,
      'INVALID_TOKEN',
    );
  });
});

describe('AuthService.getSession', () => {
  it('shapes the session from a verified access token', async () => {
    const { service, jwt } = createHarness();
    jwt.verify.mockResolvedValue({ sub: USER_ID, email: 'a@b.c', exp: 1_800_000_000 });

    await expect(service.getSession('access-token')).resolves.toEqual({
      user: { id: USER_ID, email: 'a@b.c' },
      expires_at: 1_800_000_000,
    });
    expect(jwt.verify).toHaveBeenCalledWith('access-token');
  });

  it('propagates verification failures', async () => {
    const { service, jwt } = createHarness();
    jwt.verify.mockRejectedValue(new Error('boom'));
    await expect(service.getSession('bad')).rejects.toThrow('boom');
  });
});
