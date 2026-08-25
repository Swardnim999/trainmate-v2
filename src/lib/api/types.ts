/**
 * TrainMate v2 — Frontend Typed API Client Types & DTOs
 */

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown> | Array<unknown>;
}

export interface User {
  id: string;
  email: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  user: User;
}

export type AuthChangeEvent =
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

export type AuthStateChangeCallback = (
  event: AuthChangeEvent,
  session: AuthSession | null,
) => void;

export interface Profile {
  id: string;
  name: string | null;
  bio: string | null;
  hobbies: string | null;
  college: string | null;
  gender: string | null;
  avatar_url: string | null;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

export interface UpdateProfileInput {
  name?: string | null;
  bio?: string | null;
  hobbies?: string | null;
  college?: string | null;
  gender?: string | null;
  avatar_url?: string | null;
}

export interface Journey {
  id: string;
  userId?: string;
  user_id?: string;
  userName?: string | null;
  user_name?: string | null;
  trainNumber?: string;
  train_number?: string;
  trainName?: string | null;
  train_name?: string | null;
  travelDate?: string;
  travel_date?: string;
  coach?: string | null;
  boardingStation?: string | null;
  boarding_station?: string | null;
  destinationStation?: string | null;
  destination_station?: string | null;
  college?: string | null;
  gender?: string | null;
  createdAt?: string;
  created_at?: string;
}

export interface CreateJourneyInput {
  trainNumber: string;
  train_number?: string;
  trainName?: string | null;
  train_name?: string | null;
  travelDate: string;
  travel_date?: string;
  coach?: string | null;
  boardingStation?: string | null;
  boarding_station?: string | null;
  destinationStation?: string | null;
  destination_station?: string | null;
  college?: string | null;
  gender?: string | null;
  userName?: string | null;
  user_name?: string | null;
}

export interface TrainDirectoryEntry {
  train_number: string;
  train_name: string;
  trainNumber?: string;
  trainName?: string;
}

export interface LogUnverifiedTrainInput {
  train_number?: string;
  trainNumber?: string;
  train_name?: string | null;
  trainName?: string | null;
  entered_value?: string;
  enteredValue?: string;
}

export interface CompanionRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  fromUserId?: string;
  toUserId?: string;
  from_name?: string | null;
  to_name?: string | null;
  fromName?: string | null;
  toName?: string | null;
  train_number?: string | null;
  trainNumber?: string | null;
  travel_date: string;
  travelDate?: string;
  boarding_station?: string | null;
  boardingStation?: string | null;
  destination_station?: string | null;
  destinationStation?: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
}

export interface CreateRequestInput {
  to_user_id?: string;
  toUserId?: string;
  from_name?: string | null;
  fromName?: string | null;
  to_name?: string | null;
  toName?: string | null;
  train_number?: string | null;
  trainNumber?: string | null;
  travel_date: string;
  travelDate?: string;
  boarding_station?: string | null;
  boardingStation?: string | null;
  destination_station?: string | null;
  destinationStation?: string | null;
}

export interface Conversation {
  id: string;
  participants: string[];
  participant_names?: Record<string, string>;
  participantNames?: Record<string, string>;
  train_number?: string | null;
  trainNumber?: string | null;
  travel_date?: string | null;
  travelDate?: string | null;
  last_message?: string | null;
  lastMessage?: string | null;
  last_message_time?: string | null;
  lastMessageTime?: string | null;
  deleted_for?: string[];
  deletedFor?: string[];
  created_at?: string;
  createdAt?: string;
}

export interface CreateConversationInput {
  participants: string[];
  participant_names?: Record<string, string>;
  participantNames?: Record<string, string>;
  train_number?: string | null;
  trainNumber?: string | null;
  travel_date?: string | null;
  travelDate?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  conversationId?: string;
  sender_id: string;
  senderId?: string;
  sender_name: string | null;
  senderName?: string | null;
  text: string;
  attachment_url: string | null;
  attachmentUrl?: string | null;
  attachment_type: string | null;
  attachmentType?: string | null;
  attachment_name: string | null;
  attachmentName?: string | null;
  attachment_size: number | null;
  attachmentSize?: number | null;
  created_at: string;
  createdAt?: string;
}

export interface SendMessageInput {
  text: string;
  attachment_url?: string | null;
  attachmentUrl?: string | null;
  attachment_type?: string | null;
  attachmentType?: string | null;
  attachment_name?: string | null;
  attachmentName?: string | null;
  attachment_size?: number | null;
  attachmentSize?: number | null;
}

export interface BlockedUser {
  id: string;
  blocker_id: string;
  blocked_id: string;
  created_at?: string;
}

export interface UserReport {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason?: string | null;
  created_at?: string;
}
