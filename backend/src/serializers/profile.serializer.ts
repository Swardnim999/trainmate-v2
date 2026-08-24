import type { Profile } from '@prisma/client';

export interface OwnProfileResponse {
  id: string;
  email: string;
  name: string | null;
  bio: string | null;
  hobbies: string | null;
  college: string | null;
  gender: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicProfileResponse {
  id: string;
  name: string | null;
  bio: string | null;
  hobbies: string | null;
  college: string | null;
  gender: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileNameResponse {
  name: string | null;
}

/**
 * ProfileSerializer — Enforces the strict Email Privacy Invariant (§6.12#1).
 *
 * Explicitly constructs public response objects to guarantee that another
 * user's email address is NEVER serialized into any public/companion response.
 */
export class ProfileSerializer {
  /** Serializes the user's own profile, including their account email. */
  static toOwnProfile(profile: Profile, email: string): OwnProfileResponse {
    return {
      id: profile.id,
      email,
      name: profile.name,
      bio: profile.bio,
      hobbies: profile.hobbies,
      college: profile.college,
      gender: profile.gender,
      avatar_url: profile.avatarUrl,
      created_at: profile.createdAt.toISOString(),
      updated_at: profile.updatedAt.toISOString(),
    };
  }

  /**
   * Serializes a public/companion profile.
   * STRICTLY OMITS the email property.
   */
  static toPublicProfile(profile: Profile): PublicProfileResponse {
    return {
      id: profile.id,
      name: profile.name,
      bio: profile.bio,
      hobbies: profile.hobbies,
      college: profile.college,
      gender: profile.gender,
      avatar_url: profile.avatarUrl,
      created_at: profile.createdAt.toISOString(),
      updated_at: profile.updatedAt.toISOString(),
    };
  }

  /** Serializes a display name response ({ name: string | null }). */
  static toNameOnly(name: string | null): ProfileNameResponse {
    return {
      name,
    };
  }
}
