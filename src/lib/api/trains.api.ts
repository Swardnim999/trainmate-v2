/**
 * TrainMate v2 — Trains Directory API Client
 */

import { apiClient } from './client';
import { TrainDirectoryEntry, LogUnverifiedTrainInput } from './types';

export const trainsApi = {
  async searchTrains(query: string, limit = 15): Promise<TrainDirectoryEntry[]> {
    if (!query || query.trim().length < 2) return [];
    return apiClient<TrainDirectoryEntry[]>(`/trains?q=${encodeURIComponent(query)}&limit=${limit}`);
  },

  async logUnverifiedTrain(input: LogUnverifiedTrainInput): Promise<void> {
    return apiClient<void>('/trains/unverified', {
      method: 'POST',
      body: JSON.stringify({
        trainNumber: input.trainNumber || input.train_number,
        trainName: input.trainName || input.train_name,
        enteredValue: input.enteredValue || input.entered_value,
      }),
    });
  },
};
