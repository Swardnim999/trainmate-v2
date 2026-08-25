/**
 * TrainMate v2 — Realtime Socket.IO Types
 */

import { Message } from '../../lib/api/types';

export interface PresenceUser {
  userId: string;
  onlineAt: string;
  user_id?: string;
  user_name?: string;
  name?: string;
  avatar_url?: string;
}

export interface TypingPayload {
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

export interface LastReadUpdatePayload {
  conversationId: string;
  userId: string;
  timestamp: string;
}

export interface ConversationUpdatedPayload {
  conversationId: string;
  lastMessage: string | null;
  lastMessageTime: string | null;
}

export interface ServerToClientEvents {
  'message:new': (message: Message) => void;
  'last-read:update': (payload: LastReadUpdatePayload) => void;
  'conversation:updated': (payload: ConversationUpdatedPayload) => void;
  'presence:sync': (users: PresenceUser[]) => void;
  'presence:join': (user: PresenceUser) => void;
  'presence:leave': (user: PresenceUser) => void;
  typing: (payload: TypingPayload) => void;
}

export interface ClientToServerEvents {
  'join:conversation': (data: { conversationId: string }) => void;
  'leave:conversation': (data: { conversationId: string }) => void;
  'presence:join': (data: { channel: string; metadata?: Record<string, unknown> }) => void;
  'presence:leave': (data: { channel: string }) => void;
  typing: (data: { conversationId: string; isTyping: boolean }) => void;
}
