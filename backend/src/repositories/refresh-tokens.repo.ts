import type { Prisma, PrismaClient, RefreshToken } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

export interface CreateRefreshTokenData {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Data access for `refresh_tokens` (Auth-Design §5, §10.2). Primitives only:
 * the rotation transaction (claim old + insert new) and reuse-detection family
 * revocation are composed by the service layer. `revokeById` is the atomic
 * claim — its `updateMany` touches only a still-active row (`revoked_at IS
 * NULL`), so exactly one racing rotation wins; a `false` return means the token
 * was already revoked (reuse) and callers treat that as an anomaly.
 */
export class RefreshTokenRepository {
  /** Accepts a transaction client so services can bind the repo to a `$transaction`. */
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return this.db.refreshToken.findUnique({ where: { tokenHash } });
  }

  create(data: CreateRefreshTokenData): Promise<RefreshToken> {
    return this.db.refreshToken.create({ data });
  }

  /**
   * Atomically revokes an active token, optionally recording its replacement
   * (`replaced_by_token_hash`, the rotation forensics chain pointer).
   * True if this call performed the revocation.
   */
  async revokeById(id: string, replacedByTokenHash?: string): Promise<boolean> {
    const result = await this.db.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        ...(replacedByTokenHash !== undefined ? { replacedByTokenHash } : {}),
      },
    });
    return result.count === 1;
  }

  /** Revokes every active token in a family (reuse detection). Returns the number revoked. */
  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Revokes every active token for a user (logout / password reset). Returns the number revoked. */
  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /** Pruning primitive (Phase-14 cron): deletes rows whose expiry is before `before`. */
  async deleteExpiredBefore(before: Date): Promise<number> {
    const result = await this.db.refreshToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return result.count;
  }
}
