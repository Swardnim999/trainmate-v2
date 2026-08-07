import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client — the single database-access entry point for the app.
 * Repositories default their injected client to this instance (so `new
 * UserRepository()` works standalone) while accepting a mock or a transaction
 * client in tests and when the service layer composes multi-step writes.
 *
 * Construction is lazy: the client opens no connection and fails no queries
 * until one is run, so a missing `DATABASE_URL` never surfaces at import time —
 * only on the first query.
 */
export const prisma = new PrismaClient();
