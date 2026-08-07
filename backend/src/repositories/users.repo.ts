import type { Prisma, PrismaClient, User } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isRecordNotFound } from '../lib/prisma-errors.js';

/** Input for creating a user. `id` is optional — Prisma generates the UUID. */
export interface CreateUserData {
  id?: string;
  email: string;
  passwordHash: string;
}

/**
 * Data access for `users` (Auth-Design §10.1). Thin CRUD only — no password
 * hashing, no normalization, no business rules; those live in the service
 * layer (Milestone 3). Every method returns a typed result; "record not
 * found" is a typed `null`, never a Prisma exception.
 */
export class UserRepository {
  /** Accepts a transaction client so services can bind the repo to a `$transaction`. */
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({ where: { email } });
  }

  create(data: CreateUserData): Promise<User> {
    return this.db.user.create({ data });
  }

  /** Replaces the bcrypt hash (password reset). Returns null if no such user. */
  async updatePasswordHash(id: string, passwordHash: string): Promise<User | null> {
    try {
      return await this.db.user.update({ where: { id }, data: { passwordHash } });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Marks the account confirmed (`email_confirmed_at = now()`). Returns null if no such user. */
  async confirmEmail(id: string): Promise<User | null> {
    try {
      return await this.db.user.update({
        where: { id },
        data: { emailConfirmedAt: new Date() },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Deletes the account (children cascade). Returns null if no such user. */
  async deleteById(id: string): Promise<User | null> {
    try {
      return await this.db.user.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }
}
