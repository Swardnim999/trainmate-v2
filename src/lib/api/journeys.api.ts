/**
 * TrainMate v2 — Journeys API Client
 */

import { apiClient } from './client';
import { Journey, CreateJourneyInput } from './types';

export const journeysApi = {
  async getMyJourneys(): Promise<Journey[]> {
    return apiClient<Journey[]>('/journeys/me');
  },

  async createJourney(input: CreateJourneyInput): Promise<Journey> {
    return apiClient<Journey>('/journeys', {
      method: 'POST',
      body: JSON.stringify({
        trainNumber: input.trainNumber || input.train_number,
        trainName: input.trainName || input.train_name,
        travelDate: input.travelDate || input.travel_date,
        coach: input.coach,
        boardingStation: input.boardingStation || input.boarding_station,
        destinationStation: input.destinationStation || input.destination_station,
        college: input.college,
        gender: input.gender,
        userName: input.userName || input.user_name,
      }),
    });
  },

  async deleteJourney(id: string): Promise<void> {
    return apiClient<void>(`/journeys/${id}`, {
      method: 'DELETE',
    });
  },

  async findCompanionMatches(trainNumber: string, travelDate: string): Promise<Journey[]> {
    const formattedDate = travelDate.split('T')[0];
    return apiClient<Journey[]>(`/journeys/${trainNumber}/${formattedDate}/companions`);
  },
};
