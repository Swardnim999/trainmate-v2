import { describe, expect, it, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ProfileRepository } from '../../src/repositories/profiles.repo.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';

function createMockDb() {
  return {
    profile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
}

describe('ProfileRepository', () => {
  it('findById delegates to db.profile.findUnique with id', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: 'Alex',
      bio: 'Bio',
      hobbies: 'Chess',
      college: 'IIT',
      gender: 'male',
      avatarUrl: 'https://avatar.png',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.findUnique.mockResolvedValue(mockProfile);

    const result = await repo.findById(USER_ID);

    expect(result).toEqual(mockProfile);
    expect(db.profile.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
    });
  });

  it('create inserts a profile with defaults', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: 'Sam',
      bio: null,
      hobbies: null,
      college: null,
      gender: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.create.mockResolvedValue(mockProfile);

    const result = await repo.create({ id: USER_ID, name: 'Sam' });

    expect(result).toEqual(mockProfile);
    expect(db.profile.create).toHaveBeenCalledWith({
      data: {
        id: USER_ID,
        name: 'Sam',
        bio: null,
        hobbies: null,
        college: null,
        gender: null,
        avatarUrl: null,
      },
    });
  });

  it('update updates specified fields', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: 'Updated Name',
      bio: 'Updated Bio',
      hobbies: null,
      college: null,
      gender: 'prefer_not_to_say',
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.update.mockResolvedValue(mockProfile);

    const result = await repo.update(USER_ID, {
      name: 'Updated Name',
      bio: 'Updated Bio',
      gender: 'prefer_not_to_say',
    });

    expect(result).toEqual(mockProfile);
    expect(db.profile.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: {
        name: 'Updated Name',
        bio: 'Updated Bio',
        gender: 'prefer_not_to_say',
      },
    });
  });

  it('update returns null on P2025 record not found', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const p2025Error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '6.x',
    });
    db.profile.update.mockRejectedValue(p2025Error);

    const result = await repo.update(USER_ID, { name: 'Name' });

    expect(result).toBeNull();
  });

  it('findOrCreate returns existing profile without creating', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: 'Existing',
      bio: null,
      hobbies: null,
      college: null,
      gender: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.findUnique.mockResolvedValue(mockProfile);

    const result = await repo.findOrCreate(USER_ID);

    expect(result).toEqual(mockProfile);
    expect(db.profile.create).not.toHaveBeenCalled();
  });

  it('findOrCreate creates blank profile if not found', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: null,
      bio: null,
      hobbies: null,
      college: null,
      gender: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.findUnique.mockResolvedValue(null);
    db.profile.create.mockResolvedValue(mockProfile);

    const result = await repo.findOrCreate(USER_ID);

    expect(result).toEqual(mockProfile);
    expect(db.profile.create).toHaveBeenCalledWith({
      data: {
        id: USER_ID,
        name: null,
        bio: null,
        hobbies: null,
        college: null,
        gender: null,
        avatarUrl: null,
      },
    });
  });

  it('findOrCreate recovers if race condition creates duplicate key P2002', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const mockProfile = {
      id: USER_ID,
      name: 'Raced',
      bio: null,
      hobbies: null,
      college: null,
      gender: null,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    db.profile.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(mockProfile);
    const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique violation', {
      code: 'P2002',
      clientVersion: '6.x',
    });
    db.profile.create.mockRejectedValue(p2002Error);

    const result = await repo.findOrCreate(USER_ID);

    expect(result).toEqual(mockProfile);
  });

  it('deleteById returns true on successful deletion', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    db.profile.delete.mockResolvedValue({ id: USER_ID });

    const result = await repo.deleteById(USER_ID);

    expect(result).toBe(true);
    expect(db.profile.delete).toHaveBeenCalledWith({ where: { id: USER_ID } });
  });

  it('deleteById returns false on P2025 record not found', async () => {
    const db = createMockDb();
    const repo = new ProfileRepository(db as unknown as PrismaClient);
    const p2025Error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '6.x',
    });
    db.profile.delete.mockRejectedValue(p2025Error);

    const result = await repo.deleteById(USER_ID);

    expect(result).toBe(false);
  });
});
