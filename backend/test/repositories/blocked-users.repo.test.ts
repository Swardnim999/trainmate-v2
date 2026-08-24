import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { BlockedUserRepository } from '../../src/repositories/blocked-users.repo.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const BLOCK_ID = '11111111-1111-4000-8000-111111111111';

function createMockDb() {
  return {
    blockedUser: {
      findUnique: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
}

describe('BlockedUserRepository', () => {
  it('findByPair delegates to db.blockedUser.findUnique with compound key', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    const mockBlock = {
      id: BLOCK_ID,
      blockerId: ID1,
      blockedId: ID2,
      createdAt: new Date(),
    };
    db.blockedUser.findUnique.mockResolvedValue(mockBlock);

    const result = await repo.findByPair(ID1, ID2);

    expect(result).toEqual(mockBlock);
    expect(db.blockedUser.findUnique).toHaveBeenCalledWith({
      where: {
        blockerId_blockedId: { blockerId: ID1, blockedId: ID2 },
      },
    });
  });

  it('isBlocked returns true when symmetric count > 0', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.count.mockResolvedValue(1);

    const result = await repo.isBlocked(ID1, ID2);

    expect(result).toBe(true);
    expect(db.blockedUser.count).toHaveBeenCalledWith({
      where: {
        OR: [
          { blockerId: ID1, blockedId: ID2 },
          { blockerId: ID2, blockedId: ID1 },
        ],
      },
    });
  });

  it('isBlocked returns false when symmetric count is 0', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.count.mockResolvedValue(0);

    const result = await repo.isBlocked(ID1, ID2);

    expect(result).toBe(false);
  });

  it('findBlockedIdsByBlocker returns list of blockedId strings', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.findMany.mockResolvedValue([{ blockedId: ID2 }, { blockedId: ID3 }]);

    const result = await repo.findBlockedIdsByBlocker(ID1);

    expect(result).toEqual([ID2, ID3]);
    expect(db.blockedUser.findMany).toHaveBeenCalledWith({
      where: { blockerId: ID1 },
      select: { blockedId: true },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('findSymmetricBlockedIds returns deduplicated list of other user IDs', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.findMany.mockResolvedValue([
      { blockerId: ID1, blockedId: ID2 },
      { blockerId: ID3, blockedId: ID1 },
    ]);

    const result = await repo.findSymmetricBlockedIds(ID1);

    expect(result).toContain(ID2);
    expect(result).toContain(ID3);
    expect(result).toHaveLength(2);
  });

  it('create delegates to db.blockedUser.create', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    const mockBlock = {
      id: BLOCK_ID,
      blockerId: ID1,
      blockedId: ID2,
      createdAt: new Date(),
    };
    db.blockedUser.create.mockResolvedValue(mockBlock);

    const result = await repo.create({ blockerId: ID1, blockedId: ID2 });

    expect(result).toEqual(mockBlock);
    expect(db.blockedUser.create).toHaveBeenCalledWith({
      data: { blockerId: ID1, blockedId: ID2 },
    });
  });

  it('deleteByPair returns true when matching row is deleted', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.deleteMany.mockResolvedValue({ count: 1 });

    const result = await repo.deleteByPair(ID1, ID2);

    expect(result).toBe(true);
    expect(db.blockedUser.deleteMany).toHaveBeenCalledWith({
      where: { blockerId: ID1, blockedId: ID2 },
    });
  });

  it('deleteByPair returns false when no matching row existed', async () => {
    const db = createMockDb();
    const repo = new BlockedUserRepository(db as unknown as PrismaClient);
    db.blockedUser.deleteMany.mockResolvedValue({ count: 0 });

    const result = await repo.deleteByPair(ID1, ID2);

    expect(result).toBe(false);
  });
});
