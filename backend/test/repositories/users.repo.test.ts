import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { PrismaClient, User } from '@prisma/client';
import { UserRepository, type CreateUserData } from '../../src/repositories/users.repo.js';

const USER_ID = '00000000-0000-0000-0000-000000000001';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: USER_ID,
    email: 'a@b.c',
    passwordHash: 'hash',
    emailConfirmedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function createMockDb() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

function prismaNotFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '6.19.3',
  });
}

describe('UserRepository', () => {
  let db: ReturnType<typeof createMockDb>;
  let repo: UserRepository;

  beforeEach(() => {
    db = createMockDb();
    repo = new UserRepository(db as unknown as PrismaClient);
  });

  it('findById delegates a typed findUnique by id and returns the user', async () => {
    const user = makeUser();
    db.user.findUnique.mockResolvedValue(user);

    await expect(repo.findById(USER_ID)).resolves.toEqual(user);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  it('findById returns null when no user exists', async () => {
    db.user.findUnique.mockResolvedValue(null);

    await expect(repo.findById(USER_ID)).resolves.toBeNull();
  });

  it('findByEmail delegates findUnique by email', async () => {
    const user = makeUser();
    db.user.findUnique.mockResolvedValue(user);

    await expect(repo.findByEmail('a@b.c')).resolves.toEqual(user);
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.c' } });
  });

  it('create passes the input through unchanged', async () => {
    const data: CreateUserData = { email: 'a@b.c', passwordHash: 'hash' };
    const user = makeUser();
    db.user.create.mockResolvedValue(user);

    await expect(repo.create(data)).resolves.toEqual(user);
    expect(db.user.create).toHaveBeenCalledWith({ data });
  });

  it('updatePasswordHash writes the new hash and returns the user', async () => {
    const updated = makeUser({ passwordHash: 'new-hash' });
    db.user.update.mockResolvedValue(updated);

    await expect(repo.updatePasswordHash(USER_ID, 'new-hash')).resolves.toEqual(updated);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { passwordHash: 'new-hash' },
    });
  });

  it('updatePasswordHash returns null when the user is missing (P2025)', async () => {
    db.user.update.mockRejectedValue(prismaNotFound());

    await expect(repo.updatePasswordHash(USER_ID, 'new-hash')).resolves.toBeNull();
  });

  it('confirmEmail stamps emailConfirmedAt with a Date', async () => {
    const updated = makeUser({ emailConfirmedAt: new Date('2026-01-02T00:00:00Z') });
    db.user.update.mockResolvedValue(updated);

    await expect(repo.confirmEmail(USER_ID)).resolves.toEqual(updated);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { emailConfirmedAt: expect.any(Date) },
    });
  });

  it('confirmEmail returns null when the user is missing (P2025)', async () => {
    db.user.update.mockRejectedValue(prismaNotFound());

    await expect(repo.confirmEmail(USER_ID)).resolves.toBeNull();
  });

  it('deleteById deletes and returns the user', async () => {
    const user = makeUser();
    db.user.delete.mockResolvedValue(user);

    await expect(repo.deleteById(USER_ID)).resolves.toEqual(user);
    expect(db.user.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  it('deleteById returns null when the user is missing (P2025)', async () => {
    db.user.delete.mockRejectedValue(prismaNotFound());

    await expect(repo.deleteById(USER_ID)).resolves.toBeNull();
  });

  it('re-throws errors that are not P2025', async () => {
    const error = new Error('connection refused');
    db.user.update.mockRejectedValue(error);

    await expect(repo.updatePasswordHash(USER_ID, 'new-hash')).rejects.toBe(error);
  });
});
