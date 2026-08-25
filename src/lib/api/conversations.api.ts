/**
 * TrainMate v2 — Conversations API Client
 */

import { apiClient } from './client';
import { Conversation, CreateConversationInput } from './types';

export const conversationsApi = {
  async getConversations(): Promise<Conversation[]> {
    return apiClient<Conversation[]>('/conversations');
  },

  async getConversation(id: string): Promise<Conversation> {
    return apiClient<Conversation>(`/conversations/${id}`);
  },

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return apiClient<Conversation>('/conversations', {
      method: 'POST',
      body: JSON.stringify({
        participants: input.participants,
        participantNames: input.participantNames || input.participant_names,
        trainNumber: input.trainNumber || input.train_number,
        travelDate: input.travelDate || input.travel_date,
      }),
    });
  },

  async softDeleteConversation(id: string): Promise<void> {
    return apiClient<void>(`/conversations/${id}/for-me`, {
      method: 'DELETE',
    });
  },
};
