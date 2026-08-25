import { useState, useEffect } from 'react';
import { moderationApi } from '@/lib/api/moderation.api';
import { useAuth } from '@/hooks/useAuth';

export const useBlockedUsers = () => {
  const { user } = useAuth();
  const [blockedUsers, setBlockedUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setBlockedUsers([]);
      setLoading(false);
      return;
    }

    const fetchBlockedUsers = async () => {
      try {
        const list = await moderationApi.getBlockedUsers();
        setBlockedUsers(list);
      } catch (error) {
        console.error('Error fetching blocked users:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchBlockedUsers();
  }, [user]);

  const blockUser = async (blockedId: string) => {
    if (!user) return false;

    try {
      await moderationApi.blockUser(blockedId);
      setBlockedUsers((prev) => (prev.includes(blockedId) ? prev : [...prev, blockedId]));
      return true;
    } catch (error) {
      console.error('Error blocking user:', error);
      return false;
    }
  };

  const unblockUser = async (blockedId: string) => {
    if (!user) return false;

    try {
      await moderationApi.unblockUser(blockedId);
      setBlockedUsers((prev) => prev.filter((id) => id !== blockedId));
      return true;
    } catch (error) {
      console.error('Error unblocking user:', error);
      return false;
    }
  };

  const isBlocked = (userId: string) => blockedUsers.includes(userId);

  return { blockedUsers, loading, blockUser, unblockUser, isBlocked };
};
