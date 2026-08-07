import { Prisma } from '@prisma/client';

/**
 * True when a Prisma error is P2025 — the record addressed by a unique `where`
 * does not exist. Repositories use it to translate "record not found" into a
 * typed `null` result instead of leaking a Prisma exception to callers.
 */
export function isRecordNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/**
 * True when a Prisma error is P2002 — a unique constraint violation. The register
 * flow uses it to absorb a racing double-submit (the loser sees the winner's row
 * created under its feet) and fall through to the idempotent path instead of
 * surfacing a 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
