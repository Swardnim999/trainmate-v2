import type { Prisma, PrismaClient, UserReport } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateReportData {
  id?: string;
  reporterId: string;
  reportedId: string;
  reason?: string | null;
}

/**
 * Data access for `user_reports` (Moderation-Design §5.2). Thin CRUD only.
 */
export class UserReportRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Inserts a new report row. */
  create(data: CreateReportData): Promise<UserReport> {
    return this.db.userReport.create({ data });
  }

  /** Finds a report by its primary key ID. */
  findById(id: string): Promise<UserReport | null> {
    return this.db.userReport.findUnique({ where: { id } });
  }

  /** Lists reports filed by a specific reporter. */
  findByReporterId(reporterId: string): Promise<UserReport[]> {
    return this.db.userReport.findMany({
      where: { reporterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Lists reports filed against a specific target. */
  findByReportedId(reportedId: string): Promise<UserReport[]> {
    return this.db.userReport.findMany({
      where: { reportedId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
