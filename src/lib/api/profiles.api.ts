/**
 * TrainMate v2 — Profiles API Client
 */

import { apiClient } from './client';
import { Profile, UpdateProfileInput } from './types';

export const profilesApi = {
  async getOwnProfile(): Promise<Profile> {
    return apiClient<Profile>('/profiles/me');
  },

  async updateOwnProfile(input: UpdateProfileInput): Promise<Profile> {
    return apiClient<Profile>('/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },

  async getUserProfile(userId: string): Promise<Profile> {
    return apiClient<Profile>(`/profiles/${userId}`);
  },

  async getUserDisplayName(userId: string): Promise<string> {
    try {
      const res = await apiClient<{ name: string | null }>(`/profiles/${userId}/name`);
      return res.name || 'User';
    } catch {
      return 'User';
    }
  },

  async uploadAvatar(file: Blob | File): Promise<string> {
    // Read file as base64 Data URL
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Url = reader.result as string;
          const updated = await profilesApi.updateOwnProfile({ avatar_url: base64Url });
          resolve(updated.avatar_url || base64Url);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },
};
