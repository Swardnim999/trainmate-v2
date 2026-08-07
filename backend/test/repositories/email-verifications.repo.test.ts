import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailVerification, PrismaClient } from '@prisma/client';
import {
  EmailVerificationRepository,
  type CreateEmailVerificationData,
} from '../../src/repositories/email-verifications.repo.js';

const ID = '00000000-0000-0000-0000-000000000001';

function makeVerification(overrides: Partial<EmailVerification> = {}): EmailVerification {
  return {
    id: ID,
    userId: '00000000-0000-0000-0000-000000000002',
    type: 'signup',
    tokenHash: 'hash',
    expiresAt: new Date('2026-01-02T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    consumedAt: null,
    ...overrides,
  };
}

function createMockDb() {
  return {
    emailVerification: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe('EmailVerificationRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: EmailVerificationRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new EmailVerificationRepository(db as unknown as PrismaClient);
  });

  it('findByTokenHash delegates findUnique by tokenHash', async () => {
    const verification = makeVerification();
    db.emailVerification.findUnique.mockResolvedValue(verification);

    await expect(repo.findByTokenHash('hash')).resolves.toEqual(verification);
    expect(db.emailVerification.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash' },
    });
  });

  it('findByTokenHash returns null when the token is absent', async () => {
    db.emailVerification.findUnique.mockResolvedValue(null);

    await expect(repo.findByTokenHash('nope')).resolves.toBeNull();
  });

  it('create passes a signup token through unchanged', async () => {
    const data: CreateEmailVerificationData = {
      userId: '00000000-0000-0000-0000-000000000002',
      type: 'signup',
      tokenHash: 'hash',
      expiresAt: new Date('2026-01-02T00:00:00Z'),
    };
    const verification = makeVerification(data);
    db.emailVerification.create.mockResolvedValue(verification);

    await expect(repo.create(data)).resolves.toEqual(verification);
    expect(db.emailVerification.create).toHaveBeenCalledWith({ data });
  });

  it('create accepts a password_reset token', async () => {
    const data: CreateEmailVerificationData = {
      userId: '00000000-0000-0000-0000-000000000002',
      type: 'password_reset',
      tokenHash: 'reset-hash',
      expiresAt: new Date('2026-01-02T00:00:00Z'),
    };
    const verification = makeVerification(data);
    db.emailVerification.create.mockResolvedValue(verification);

    await expect(repo.create(data)).resolves.toEqual(verification);
  });

  it('consumeById claims an unconsumed token: count 1 means this call consumed it', async () => {
    db.emailVerification.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.consumeById(ID)).resolves.toBe(true);
    expect(db.emailVerification.updateMany).toHaveBeenCalledWith({
      where: { id: ID, consumedAt: null },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('consumeById reports false when the token was already consumed (count 0)', async () => {
    db.emailVerification.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.consumeById(ID)).resolves.toBe(false);
  });

  it('deleteExpiredBefore deletes tokens expiring before the cutoff and returns the count', async () => {
    const before = new Date('2026-02-01T00:00:00Z');
    db.emailVerification.deleteMany.mockResolvedValue({ count: 4 });

    await expect(repo.deleteExpiredBefore(before)).resolves.toBe(4);
    expect(db.emailVerification.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: before } },
    });
  });
});
