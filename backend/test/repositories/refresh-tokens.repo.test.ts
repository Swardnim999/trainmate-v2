import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, RefreshToken } from '@prisma/client';
import {
  RefreshTokenRepository,
  type CreateRefreshTokenData,
} from '../../src/repositories/refresh-tokens.repo.js';

const ID = '00000000-0000-0000-0000-000000000001';

function makeToken(overrides: Partial<RefreshToken> = {}): RefreshToken {
  return {
    id: ID,
    userId: '00000000-0000-0000-0000-000000000002',
    familyId: '00000000-0000-0000-0000-000000000003',
    tokenHash: 'hash',
    expiresAt: new Date('2026-02-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    revokedAt: null,
    replacedByTokenHash: null,
    ...overrides,
  };
}

function createMockDb() {
  return {
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe('RefreshTokenRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: RefreshTokenRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new RefreshTokenRepository(db as unknown as PrismaClient);
  });

  it('findByTokenHash delegates findUnique by tokenHash', async () => {
    const token = makeToken();
    db.refreshToken.findUnique.mockResolvedValue(token);

    await expect(repo.findByTokenHash('hash')).resolves.toEqual(token);
    expect(db.refreshToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: 'hash' },
    });
  });

  it('findByTokenHash returns null when the token is absent', async () => {
    db.refreshToken.findUnique.mockResolvedValue(null);

    await expect(repo.findByTokenHash('nope')).resolves.toBeNull();
  });

  it('create passes the input through unchanged', async () => {
    const data: CreateRefreshTokenData = {
      userId: '00000000-0000-0000-0000-000000000002',
      familyId: '00000000-0000-0000-0000-000000000003',
      tokenHash: 'hash',
      expiresAt: new Date('2026-02-01T00:00:00Z'),
    };
    const token = makeToken(data);
    db.refreshToken.create.mockResolvedValue(token);

    await expect(repo.create(data)).resolves.toEqual(token);
    expect(db.refreshToken.create).toHaveBeenCalledWith({ data });
  });

  it('revokeById claims an active token: count 1 means this call revoked it', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.revokeById(ID)).resolves.toBe(true);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: ID, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokeById reports false when the token was already revoked (count 0)', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.revokeById(ID)).resolves.toBe(false);
  });

  it('revokeById records the replacement hash when rotating', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(repo.revokeById(ID, 'next-hash')).resolves.toBe(true);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: ID, revokedAt: null },
      data: { revokedAt: expect.any(Date), replacedByTokenHash: 'next-hash' },
    });
  });

  it('revokeFamily revokes every active token in the family and returns the count', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 3 });

    await expect(repo.revokeFamily('family-1')).resolves.toBe(3);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('revokeAllForUser revokes every active token for the user and returns the count', async () => {
    db.refreshToken.updateMany.mockResolvedValue({ count: 2 });

    await expect(repo.revokeAllForUser('user-1')).resolves.toBe(2);
    expect(db.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('deleteExpiredBefore deletes rows expiring before the cutoff and returns the count', async () => {
    const before = new Date('2026-03-01T00:00:00Z');
    db.refreshToken.deleteMany.mockResolvedValue({ count: 5 });

    await expect(repo.deleteExpiredBefore(before)).resolves.toBe(5);
    expect(db.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: before } },
    });
  });
});
