/**
 * TrainMate v2 — Moderation API Client
 */

import { apiClient } from './client';
import { BlockedUser, UserReport } from './types';

export const moderationApi = {
  async getBlockedUsers(): Promise<string[]> {
    const list = await apiClient<Array<string | BlockedUser>>('/blocked-users');
    return list.map((item) => (typeof item === 'string' ? item : item.blocked_id));
  },

  async blockUser(blockedId: string): Promise<BlockedUser> {
    return apiClient<BlockedUser>('/blocked-users', {
      method: 'POST',
      body: JSON.stringify({ blocked_id: blockedId }),
    });
  },

  async unblockUser(blockedId: string): Promise<void> {
    return apiClient<void>(`/blocked-users/${blockedId}`, {
      method: 'DELETE',
    });
  },

  async reportUser(reportedId: string, reason?: string | null): Promise<UserReport> {
    return apiClient<UserReport>('/reports', {
      method: 'POST',
      body: JSON.stringify({
        reported_id: reportedId,
        reason: reason || null,
      }),
    });
  },
};
