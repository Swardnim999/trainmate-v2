import type { Conversation } from '@prisma/client';
import { formatTravelDate } from './journey.serializer.js';

export interface SerializedConversation {
  id: string;
  participants: string[];
  participantNames: Record<string, string>;
  participant_names: Record<string, string>;
  trainNumber: string | null;
  train_number: string | null;
  travelDate: string | null;
  travel_date: string | null;
  lastMessage: string | null;
  last_message: string | null;
  lastMessageTime: string | null;
  last_message_time: string | null;
  createdAt: string;
  created_at: string;
}

/**
 * Serializes Conversation models into API responses (Spec §3.2, §6.4, §9.5; Conversations-Design §10).
 * Dual camelCase and snake_case properties are emitted for full backward compatibility
 * with existing frontend hooks and components (`useChat.tsx`, `Chats.tsx`).
 *
 * Strictly enforces the Email Privacy Invariant: NO email fields are ever included.
 */
export class ConversationSerializer {
  static toResponse(conversation: Conversation): SerializedConversation {
    const formattedTravelDate = conversation.travelDate
      ? formatTravelDate(conversation.travelDate)
      : null;
    const names = (conversation.participantNames as Record<string, string>) || {};

    return {
      id: conversation.id,
      participants: conversation.participants,
      participantNames: names,
      participant_names: names,
      trainNumber: conversation.trainNumber,
      train_number: conversation.trainNumber,
      travelDate: formattedTravelDate,
      travel_date: formattedTravelDate,
      lastMessage: conversation.lastMessage,
      last_message: conversation.lastMessage,
      lastMessageTime: conversation.lastMessageTime
        ? conversation.lastMessageTime.toISOString()
        : null,
      last_message_time: conversation.lastMessageTime
        ? conversation.lastMessageTime.toISOString()
        : null,
      createdAt: conversation.createdAt.toISOString(),
      created_at: conversation.createdAt.toISOString(),
    };
  }

  static toResponseList(conversations: Conversation[]): SerializedConversation[] {
    return conversations.map((c) => this.toResponse(c));
  }
}
