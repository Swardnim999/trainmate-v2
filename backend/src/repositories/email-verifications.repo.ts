import type { EmailVerification, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** App-enforced token kind (Auth-Design §10.3) — mirrored by the DB CHECK constraint. */
export type EmailVerificationType = 'signup' | 'password_reset';

export interface CreateEmailVerificationData {
  userId: string;
  type: EmailVerificationType;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Data access for `email_verifications` (Auth-Design §6, §7, §10.3). Primitives
 * only. `consumeById` is the atomic single-use claim — its `updateMany` touches
 * only an unconsumed row (`consumed_at IS NULL`), so exactly one concurrent
 * confirm/reset wins. The service layer composes consumption with the user
 * mutation in one transaction.
 */
export class EmailVerificationRepository {
  /** Accepts a transaction client so services can bind the repo to a `$transaction`. */
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  findByTokenHash(tokenHash: string): Promise<EmailVerification | null> {
    return this.db.emailVerification.findUnique({ where: { tokenHash } });
  }

  create(data: CreateEmailVerificationData): Promise<EmailVerification> {
    return this.db.emailVerification.create({ data });
  }

  /** Atomically marks a token consumed. True if this call consumed it, false if already consumed. */
  async consumeById(id: string): Promise<boolean> {
    const result = await this.db.emailVerification.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Pruning primitive (Phase-14 cron): deletes tokens whose expiry is before `before`. */
  async deleteExpiredBefore(before: Date): Promise<number> {
    const result = await this.db.emailVerification.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return result.count;
  }
}
