import type { Server as SocketIOServer } from 'socket.io';
import type { SerializedMessage, SerializedLastRead } from '../serializers/message.serializer.js';
import type { SerializedConversation } from '../serializers/conversation.serializer.js';
import type { SerializedRequest } from '../serializers/request.serializer.js';

export interface LastReadUpdatePayload {
  userId: string;
  user_id: string;
  conversationId: string;
  conversation_id: string;
  timestamp: string | null;
}

/**
 * RealtimeBroadcaster — Dispatches real-time events to Socket.IO rooms post-commit
 * (Spec §8.5; Roadmap Phase 12; Realtime-Design §11; Post-Cutover-Hardening-Design §6.2).
 */
export class RealtimeBroadcaster {
  constructor(private readonly io: SocketIOServer) {}

  /**
   * Broadcasts a newly created message to all sockets in the conversation room (`conv:<cid>`).
   * Includes the sender's own socket so the client receives the authoritative server echo.
   */
  broadcastNewMessage(conversationId: string, message: SerializedMessage): void {
    this.io.to(`conv:${conversationId}`).emit('message:new', message);
  }

  /**
   * Broadcasts a read receipt update to all sockets in the conversation room (`conv:<cid>`).
   */
  broadcastLastRead(conversationId: string, userId: string, lastRead: SerializedLastRead): void {
    const payload: LastReadUpdatePayload = {
      userId,
      user_id: userId,
      conversationId,
      conversation_id: conversationId,
      timestamp: lastRead.timestamp,
    };
    this.io.to(`conv:${conversationId}`).emit('last-read:update', payload);
  }

  /**
   * Broadcasts a conversation preview / metadata update to each participant's user room (`user:<uid>`).
   */
  broadcastConversationUpdated(
    participantIds: string[],
    conversation: SerializedConversation,
  ): void {
    for (const userId of participantIds) {
      this.io.to(`user:${userId}`).emit('conversation:updated', conversation);
    }
  }

  /**
   * Broadcasts a new incoming companion request to the recipient's user room (`user:<toUserId>`).
   */
  broadcastRequestNew(toUserId: string, request: SerializedRequest): void {
    this.io.to(`user:${toUserId}`).emit('request:new', request);
  }

  /**
   * Broadcasts a companion request status update (accepted, rejected, cancelled) to the involved users' rooms.
   */
  broadcastRequestUpdated(userIds: string[], request: SerializedRequest): void {
    for (const userId of userIds) {
      this.io.to(`user:${userId}`).emit('request:updated', request);
    }
  }

  /**
   * Broadcasts a companion roster update signal upon acceptance/rejection to both users' rooms.
   */
  broadcastCompanionsUpdated(
    userIds: string[],
    payload?: { requestId?: string; status?: string },
  ): void {
    for (const userId of userIds) {
      this.io.to(`user:${userId}`).emit('companions:updated', payload ?? {});
    }
  }
}
