import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  bio: string | null;
  hobbies: string | null;
  college: string | null;
  gender: string | null;
  avatar_url: string | null;
}

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
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, bio, hobbies, college, gender, avatar_url')
        .eq('id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
      }
      
      setProfile(data as Profile | null);
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
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, ...updates } : null);
      return { error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { error };
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!user) return { error: new Error('Not authenticated'), url: null };

    const fileExt = file.name.split('.').pop();
    const fileName = `${user.id}/avatar.${fileExt}`;

    try {
      // Delete existing avatar if any
      await supabase.storage
        .from('avatars')
        .remove([fileName]);

      // Upload new avatar
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Bucket is private — generate a long-lived signed URL for the avatar.
      // We store the signed URL on the profile so it can be rendered by other
      // authenticated users (companions). The cache-buster (avatarVersion) is
      // appended at render time via getAvatarUrl().
      const { data: signed, error: signErr } = await supabase.storage
        .from('avatars')
        .createSignedUrl(fileName, 60 * 60 * 24 * 365); // 1 year

      if (signErr) throw signErr;

      const avatarUrl = signed?.signedUrl ?? null;

      // Update profile with avatar URL
      await updateProfile({ avatar_url: avatarUrl });

      return { error: null, url: avatarUrl };
    } catch (error) {
      console.error('Error uploading avatar:', error);
      return { error, url: null };
    }
  };

  const fetchUserProfile = async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, bio, hobbies, college, gender, avatar_url')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }

      return data as Profile;
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
    refreshAvatar
  };
};
