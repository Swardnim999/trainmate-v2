import { useState, useEffect, useCallback } from 'react';
import { profilesApi } from '@/lib/api/profiles.api';
import { Profile } from '@/lib/api/types';
import { useAuth } from './useAuth';

export type { Profile };

export const useProfile = () => {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarVersion, setAvatarVersion] = useState<number>(() => Date.now());

  const fetchProfile = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    try {
      const data = await profilesApi.getOwnProfile();
      setProfile(data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Get avatar URL with cache buster
  const getAvatarUrl = useCallback((url: string | null | undefined): string | undefined => {
    if (!url) return undefined;
    const baseUrl = url.split('?')[0];
    return `${baseUrl}?t=${avatarVersion}`;
  }, [avatarVersion]);

  // Call this after uploading a new avatar to bust the cache
  const refreshAvatar = useCallback(() => {
    setAvatarVersion(Date.now());
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return { error: new Error('Not authenticated') };

    try {
      const updated = await profilesApi.updateOwnProfile(updates);
      setProfile(updated);
      return { error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { error: error as Error };
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!user) return { error: new Error('Not authenticated'), url: null };

    try {
      const avatarUrl = await profilesApi.uploadAvatar(file);
      setProfile((prev) => (prev ? { ...prev, avatar_url: avatarUrl } : null));
      refreshAvatar();
      return { error: null, url: avatarUrl };
    } catch (error) {
      console.error('Error uploading avatar:', error);
      return { error: error as Error, url: null };
    }
  };

  const fetchUserProfile = async (userId: string): Promise<Profile | null> => {
    try {
      const data = await profilesApi.getUserProfile(userId);
      return data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  };

  return {
    profile,
    loading,
    fetchProfile,
    updateProfile,
    uploadAvatar,
    fetchUserProfile,
    getAvatarUrl,
    refreshAvatar,
  };
};
