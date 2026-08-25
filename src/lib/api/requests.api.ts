/**
 * TrainMate v2 — Requests API Client
 */

import { apiClient } from './client';
import { CompanionRequest, CreateRequestInput } from './types';

export const requestsApi = {
  async getMyRequests(type: 'all' | 'sent' | 'received' = 'all'): Promise<CompanionRequest[]> {
    return apiClient<CompanionRequest[]>(`/requests/me?type=${type}`);
  },

  async getAcceptedCompanions(): Promise<CompanionRequest[]> {
    return apiClient<CompanionRequest[]>('/requests/me/accepted');
  },

  async getPendingIncomingCount(): Promise<number> {
    const res = await apiClient<{ count: number }>('/requests/incoming/pending-count');
    return res.count;
  },

  async sendRequest(input: CreateRequestInput): Promise<CompanionRequest> {
    return apiClient<CompanionRequest>('/requests', {
      method: 'POST',
      body: JSON.stringify({
        toUserId: input.toUserId || input.to_user_id,
        fromName: input.fromName || input.from_name,
        toName: input.toName || input.to_name,
        trainNumber: input.trainNumber || input.train_number,
        travelDate: input.travelDate || input.travel_date,
        boardingStation: input.boardingStation || input.boarding_station,
        destinationStation: input.destinationStation || input.destination_station,
      }),
    });
  },

  async acceptRequest(id: string): Promise<CompanionRequest> {
    return apiClient<CompanionRequest>(`/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
    });
  },

  async rejectRequest(id: string): Promise<CompanionRequest> {
    return apiClient<CompanionRequest>(`/requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected' }),
    });
  },

  async cancelRequest(id: string): Promise<void> {
    return apiClient<void>(`/requests/${id}`, {
      method: 'DELETE',
    });
  },

  async cleanupExpired(cutoffDate?: string): Promise<{ count: number }> {
    return apiClient<{ count: number }>('/requests/cleanup-expired', {
      method: 'POST',
      body: JSON.stringify({ cutoffDate }),
    });
  },
};
