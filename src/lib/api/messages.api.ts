/**
 * TrainMate v2 — Messages API Client
 */

import { apiClient } from './client';
import { Message, SendMessageInput } from './types';

export const messagesApi = {
  async getMessages(conversationId: string, limit = 50, before?: string): Promise<Message[]> {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    if (before) params.set('before', before);
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient<Message[]>(`/conversations/${conversationId}/messages${query}`);
  },

  async sendMessage(conversationId: string, input: SendMessageInput): Promise<Message> {
    return apiClient<Message>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text: input.text || '',
        attachmentUrl: input.attachmentUrl || input.attachment_url,
        attachmentType: input.attachmentType || input.attachment_type,
        attachmentName: input.attachmentName || input.attachment_name,
        attachmentSize: input.attachmentSize !== undefined ? input.attachmentSize : input.attachment_size,
      }),
    });
  },

  async getUnreadCount(conversationId: string): Promise<number> {
    const res = await apiClient<{ count: number }>(`/conversations/${conversationId}/messages/unread-count`);
    return res.count;
  },

  async getLastRead(conversationId: string, userId: string): Promise<string | null> {
    try {
      const res = await apiClient<{ timestamp: string | null }>(`/conversations/${conversationId}/last-read/${userId}`);
      return res.timestamp;
    } catch {
      return null;
    }
  },

  async markAsRead(conversationId: string): Promise<{ timestamp: string | null }> {
    return apiClient<{ timestamp: string | null }>(`/conversations/${conversationId}/last-read`, {
      method: 'PUT',
    });
  },

  async uploadAttachment(file: File): Promise<{
    url: string;
    type: string;
    name: string;
    size: number;
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          url: reader.result as string,
          type: file.type,
          name: file.name,
          size: file.size,
        });
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },
};
