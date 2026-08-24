import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { UserReportRepository } from '../../src/repositories/user-reports.repo.js';

const REPORTER_ID = '00000000-0000-4000-8000-000000000001';
const REPORTED_ID = '00000000-0000-4000-8000-000000000002';
const REPORT_ID = '22222222-2222-4000-8000-222222222222';

function createMockDb() {
  return {
    userReport: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

describe('UserReportRepository', () => {
  it('create delegates to db.userReport.create', async () => {
    const db = createMockDb();
    const repo = new UserReportRepository(db as unknown as PrismaClient);
    const mockReport = {
      id: REPORT_ID,
      reporterId: REPORTER_ID,
      reportedId: REPORTED_ID,
      reason: 'Harassment',
      createdAt: new Date(),
    };
    db.userReport.create.mockResolvedValue(mockReport);

    const result = await repo.create({
      reporterId: REPORTER_ID,
      reportedId: REPORTED_ID,
      reason: 'Harassment',
    });

    expect(result).toEqual(mockReport);
    expect(db.userReport.create).toHaveBeenCalledWith({
      data: {
        reporterId: REPORTER_ID,
        reportedId: REPORTED_ID,
        reason: 'Harassment',
      },
    });
  });

  it('findById delegates to db.userReport.findUnique', async () => {
    const db = createMockDb();
    const repo = new UserReportRepository(db as unknown as PrismaClient);
    const mockReport = {
      id: REPORT_ID,
      reporterId: REPORTER_ID,
      reportedId: REPORTED_ID,
      reason: null,
      createdAt: new Date(),
    };
    db.userReport.findUnique.mockResolvedValue(mockReport);

    const result = await repo.findById(REPORT_ID);

    expect(result).toEqual(mockReport);
    expect(db.userReport.findUnique).toHaveBeenCalledWith({
      where: { id: REPORT_ID },
    });
  });

  it('findByReporterId queries reports by reporterId ordered by createdAt desc', async () => {
    const db = createMockDb();
    const repo = new UserReportRepository(db as unknown as PrismaClient);
    db.userReport.findMany.mockResolvedValue([{ id: REPORT_ID }]);

    const result = await repo.findByReporterId(REPORTER_ID);

    expect(result).toEqual([{ id: REPORT_ID }]);
    expect(db.userReport.findMany).toHaveBeenCalledWith({
      where: { reporterId: REPORTER_ID },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('findByReportedId queries reports by reportedId ordered by createdAt desc', async () => {
    const db = createMockDb();
    const repo = new UserReportRepository(db as unknown as PrismaClient);
    db.userReport.findMany.mockResolvedValue([{ id: REPORT_ID }]);

    const result = await repo.findByReportedId(REPORTED_ID);

    expect(result).toEqual([{ id: REPORT_ID }]);
    expect(db.userReport.findMany).toHaveBeenCalledWith({
      where: { reportedId: REPORTED_ID },
      orderBy: { createdAt: 'desc' },
    });
  });
});
