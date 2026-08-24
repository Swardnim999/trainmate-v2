import { ProfileRepository, type UpdateProfileData } from '../repositories/profiles.repo.js';
import { UserRepository } from '../repositories/users.repo.js';
import { AccessService } from './access.service.js';
import {
  ProfileSerializer,
  type OwnProfileResponse,
  type PublicProfileResponse,
  type ProfileNameResponse,
} from '../serializers/profile.serializer.js';
import { AppError } from '../utils/errors.js';

export interface UpdateProfileInput {
  name?: string | null;
  bio?: string | null;
  hobbies?: string | null;
  college?: string | null;
  gender?: string | null;
  avatar_url?: string | null;
}

export interface ProfileServiceDeps {
  profiles?: ProfileRepository;
  users?: UserRepository;
  access?: AccessService;
}

/**
 * ProfileService — Profile business logic, identity, and visibility gating (Spec §6.1, §9.1, §10.2).
 */
export class ProfileService {
  private readonly profiles: ProfileRepository;
  private readonly users: UserRepository;
  private readonly access: AccessService;

  constructor(deps: Partial<ProfileServiceDeps> = {}) {
    this.profiles = deps.profiles ?? new ProfileRepository();
    this.users = deps.users ?? new UserRepository();
    this.access = deps.access ?? new AccessService();
  }

  /**
   * Retrieves the authenticated user's own profile, including their account email.
   * Does NOT require canViewProfile authorization (self-ownership).
   */
  async getOwnProfile(userId: string): Promise<OwnProfileResponse> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const profile = await this.profiles.findOrCreate(userId);
    return ProfileSerializer.toOwnProfile(profile, user.email);
  }

  /**
   * Updates the authenticated user's own profile.
   * Trims text fields, normalizes gender enum, and returns updated own profile.
   */
  async updateOwnProfile(userId: string, input: UpdateProfileInput): Promise<OwnProfileResponse> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Ensure profile row exists before update
    await this.profiles.findOrCreate(userId);

    const updateData: UpdateProfileData = {};

    if (input.name !== undefined) {
      updateData.name =
        typeof input.name === 'string' && input.name.trim().length > 0 ? input.name.trim() : null;
    }

    if (input.bio !== undefined) {
      updateData.bio =
        typeof input.bio === 'string' && input.bio.trim().length > 0 ? input.bio.trim() : null;
    }

    if (input.hobbies !== undefined) {
      updateData.hobbies =
        typeof input.hobbies === 'string' && input.hobbies.trim().length > 0
          ? input.hobbies.trim()
          : null;
    }

    if (input.college !== undefined) {
      updateData.college =
        typeof input.college === 'string' && input.college.trim().length > 0
          ? input.college.trim()
          : null;
    }

    if (input.gender !== undefined) {
      if (input.gender === null || input.gender.trim().length === 0) {
        updateData.gender = null;
      } else {
        const trimmed = input.gender.trim();
        // Normalize hyphenated variant to canonical underscore format
        updateData.gender = trimmed === 'prefer-not-to-say' ? 'prefer_not_to_say' : trimmed;
      }
    }

    if (input.avatar_url !== undefined) {
      updateData.avatarUrl =
        typeof input.avatar_url === 'string' && input.avatar_url.trim().length > 0
          ? input.avatar_url.trim()
          : null;
    }

    const updated = await this.profiles.update(userId, updateData);
    if (!updated) {
      throw new AppError(500, 'INTERNAL_SERVER_ERROR', 'Failed to update profile');
    }

    return ProfileSerializer.toOwnProfile(updated, user.email);
  }

  /**
   * Retrieves another user's public profile.
   * Enforces canViewProfile authorization and STRICTLY OMITS the email address.
   */
  async getPublicProfile(
    requesterId: string,
    targetUserId: string,
  ): Promise<PublicProfileResponse> {
    const canView = await this.access.canViewProfile(requesterId, targetUserId);
    if (!canView) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const profile = await this.profiles.findById(targetUserId);
    if (!profile) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    return ProfileSerializer.toPublicProfile(profile);
  }

  /**
   * Retrieves another user's display name ({ name: string | null }).
   * Used before conversation creation. Returns { name: null } if unviewable.
   */
  async getProfileName(requesterId: string, targetUserId: string): Promise<ProfileNameResponse> {
    const canView = await this.access.canViewProfile(requesterId, targetUserId);
    if (!canView) {
      return ProfileSerializer.toNameOnly(null);
    }

    const profile = await this.profiles.findById(targetUserId);
    return ProfileSerializer.toNameOnly(profile?.name ?? null);
  }

  /**
   * Bootstraps a blank profile for a newly-registered user.
   */
  async bootstrapProfile(userId: string): Promise<void> {
    await this.profiles.findOrCreate(userId);
  }
}
