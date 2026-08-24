import type { Request } from '@prisma/client';
import { formatTravelDate } from './journey.serializer.js';

export interface SerializedRequest {
  id: string;
  fromUserId: string;
  from_user_id: string;
  fromName: string | null;
  from_name: string | null;
  toUserId: string;
  to_user_id: string;
  toName: string | null;
  to_name: string | null;
  trainNumber: string | null;
  train_number: string | null;
  travelDate: string | null;
  travel_date: string | null;
  boardingStation: string | null;
  boarding_station: string | null;
  destinationStation: string | null;
  destination_station: string | null;
  status: string;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
}

/**
 * Serializes Request models into API responses (Spec §3.2, §6.3, §9.4; Requests-Design §8).
 * Dual camelCase and snake_case properties are emitted for full backward compatibility
 * with existing frontend hooks (useRequests.ts, useAcceptedCompanions.ts, Matched.tsx).
 *
 * Strictly enforces the Email Privacy Invariant: NO email fields are ever included.
 */
export class RequestSerializer {
  static toResponse(request: Request): SerializedRequest {
    const formattedTravelDate = request.travelDate ? formatTravelDate(request.travelDate) : null;

    return {
      id: request.id,
      fromUserId: request.fromUserId,
      from_user_id: request.fromUserId,
      fromName: request.fromName,
      from_name: request.fromName,
      toUserId: request.toUserId,
      to_user_id: request.toUserId,
      toName: request.toName,
      to_name: request.toName,
      trainNumber: request.trainNumber,
      train_number: request.trainNumber,
      travelDate: formattedTravelDate,
      travel_date: formattedTravelDate,
      boardingStation: request.boardingStation,
      boarding_station: request.boardingStation,
      destinationStation: request.destinationStation,
      destination_station: request.destinationStation,
      status: request.status,
      createdAt: request.createdAt.toISOString(),
      created_at: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
      updated_at: request.updatedAt.toISOString(),
    };
  }

  static toResponseList(requests: Request[]): SerializedRequest[] {
    return requests.map((r) => this.toResponse(r));
  }
}
