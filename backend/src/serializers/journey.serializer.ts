import type { Journey, Train, UnverifiedTrain } from '@prisma/client';

export interface JourneyResponse {
  id: string;
  user_id: string;
  user_name: string | null;
  train_number: string;
  train_name: string | null;
  travel_date: string;
  coach: string | null;
  boarding_station: string | null;
  destination_station: string | null;
  college: string | null;
  gender: string | null;
  created_at: string;
}

export interface TrainResponse {
  train_number: string;
  train_name: string;
}

export interface UnverifiedTrainResponse {
  id: string;
  train_number: string;
  train_name: string | null;
  submitted_by: string | null;
  created_at: string;
}

/**
 * Formats a Date object to YYYY-MM-DD string cleanly without timezone drift.
 */
export function formatTravelDate(date: Date | string): string {
  if (typeof date === 'string') {
    return date.split('T')[0] ?? date;
  }
  return date.toISOString().split('T')[0] ?? '';
}

/**
 * Serializes Journey models into API responses.
 * Strictly guarantees the Email Privacy Invariant: NO email is ever exposed.
 */
export class JourneySerializer {
  static toResponse(journey: Journey): JourneyResponse {
    return {
      id: journey.id,
      user_id: journey.userId,
      user_name: journey.userName,
      train_number: journey.trainNumber,
      train_name: journey.trainName,
      travel_date: formatTravelDate(journey.travelDate),
      coach: journey.coach,
      boarding_station: journey.boardingStation,
      destination_station: journey.destinationStation,
      college: journey.college,
      gender: journey.gender,
      created_at: journey.createdAt.toISOString(),
    };
  }

  static toResponseList(journeys: Journey[]): JourneyResponse[] {
    return journeys.map((j) => this.toResponse(j));
  }

  static toTrainResponse(train: Train): TrainResponse {
    return {
      train_number: train.trainNumber,
      train_name: train.trainName,
    };
  }

  static toTrainResponseList(trains: Train[]): TrainResponse[] {
    return trains.map((t) => this.toTrainResponse(t));
  }

  static toUnverifiedTrainResponse(entry: UnverifiedTrain): UnverifiedTrainResponse {
    return {
      id: entry.id,
      train_number: entry.trainNumber,
      train_name: entry.trainName,
      submitted_by: entry.submittedBy,
      created_at: entry.createdAt.toISOString(),
    };
  }
}
