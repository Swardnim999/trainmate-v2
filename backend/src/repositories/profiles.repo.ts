import type { Prisma, PrismaClient, Profile } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { isRecordNotFound, isUniqueViolation } from '../lib/prisma-errors.js';

export interface CreateProfileData {
  id: string;
  name?: string | null;
  bio?: string | null;
  hobbies?: string | null;
  college?: string | null;
  gender?: string | null;
  avatarUrl?: string | null;
}

export interface UpdateProfileData {
  name?: string | null;
  bio?: string | null;
  hobbies?: string | null;
  college?: string | null;
  gender?: string | null;
  avatarUrl?: string | null;
}

/**
 * Data access layer for `profiles` (Spec §3.2, Profiles-Design §9.1).
 * Thin Prisma wrapper with zero business logic.
 */
export class ProfileRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient = prisma) {}

  /** Finds a profile by primary key (userId). */
  findById(id: string): Promise<Profile | null> {
    return this.db.profile.findUnique({
      where: { id },
    });
  }

  /** Inserts a new profile row. */
  create(data: CreateProfileData): Promise<Profile> {
    return this.db.profile.create({
      data: {
        id: data.id,
        name: data.name ?? null,
        bio: data.bio ?? null,
        hobbies: data.hobbies ?? null,
        college: data.college ?? null,
        gender: data.gender ?? null,
        avatarUrl: data.avatarUrl ?? null,
      },
    });
  }

  /**
   * Updates an existing profile row.
   * Returns null if record does not exist (P2025).
   */
  async update(id: string, data: UpdateProfileData): Promise<Profile | null> {
    try {
      return await this.db.profile.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.bio !== undefined ? { bio: data.bio } : {}),
          ...(data.hobbies !== undefined ? { hobbies: data.hobbies } : {}),
          ...(data.college !== undefined ? { college: data.college } : {}),
          ...(data.gender !== undefined ? { gender: data.gender } : {}),
          ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Finds a profile by ID or creates a blank profile row if missing (idempotent bootstrap).
   */
  async findOrCreate(id: string): Promise<Profile> {
    const existing = await this.findById(id);
    if (existing) {
      return existing;
    }

    try {
      return await this.create({ id });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raceExisting = await this.findById(id);
        if (raceExisting) return raceExisting;
      }
      throw error;
    }
  }

  /** Deletes a profile by ID. Returns true if deleted, false if did not exist. */
  async deleteById(id: string): Promise<boolean> {
    try {
      await this.db.profile.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      if (isRecordNotFound(error)) {
        return false;
      }
      throw error;
    }
  }
}
