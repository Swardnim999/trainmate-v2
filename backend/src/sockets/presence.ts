import type { Server as SocketIOServer } from 'socket.io';
import type { AuthenticatedSocket } from './middleware/socket-auth.js';

export interface PresenceSyncPayload {
  conversationId: string;
  users: Record<string, { online: boolean }>;
}

export interface PresenceJoinPayload {
  conversationId: string;
  userId: string;
}

export interface PresenceLeavePayload {
  conversationId: string;
  userId: string;
  lastSeen: string;
}

/**
 * PresenceCoordinator — Manages in-memory presence and multi-tab collapse per conversation
 * (Spec §8.5; Roadmap Phase 12; Realtime-Design §6, §8, §9).
 */
export class PresenceCoordinator {
  // Map<conversationId, Map<userId, socketCount>>
  private readonly rooms = new Map<string, Map<string, number>>();
  // Map<socketId, Set<conversationId>>
  private readonly socketRooms = new Map<string, Set<string>>();

  constructor(private readonly io: SocketIOServer) {}

  /**
   * Registers a socket join into a conversation presence room.
   */
  handleJoin(socket: AuthenticatedSocket, conversationId: string): void {
    const userId = socket.user.id;
    const socketId = socket.id;

    if (!this.rooms.has(conversationId)) {
      this.rooms.set(conversationId, new Map());
    }
    const userMap = this.rooms.get(conversationId)!;
    const currentCount = userMap.get(userId) || 0;
    userMap.set(userId, currentCount + 1);

    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(conversationId);

    // 1. Emit presence:sync to joining socket with snapshot of current online users
    const usersSnapshot: Record<string, { online: boolean }> = {};
    for (const [uid, count] of userMap.entries()) {
      if (count > 0) {
        usersSnapshot[uid] = { online: true };
      }
    }
    const syncPayload: PresenceSyncPayload = {
      conversationId,
      users: usersSnapshot,
    };
    socket.emit('presence:sync', syncPayload);

    // 2. If this was the user's first socket in the room, broadcast presence:join to the room
    if (currentCount === 0) {
      const joinPayload: PresenceJoinPayload = {
        conversationId,
        userId,
      };
      this.io.to(`conv:${conversationId}`).emit('presence:join', joinPayload);
    }
  }

  /**
   * Handles explicit leave from a conversation presence room.
   */
  handleLeave(socket: AuthenticatedSocket, conversationId: string): void {
    const userId = socket.user.id;
    const socketId = socket.id;

    this.socketRooms.get(socketId)?.delete(conversationId);

    const userMap = this.rooms.get(conversationId);
    if (!userMap) return;

    const currentCount = userMap.get(userId) || 0;
    if (currentCount <= 1) {
      userMap.delete(userId);
      if (userMap.size === 0) {
        this.rooms.delete(conversationId);
      }
      const leavePayload: PresenceLeavePayload = {
        conversationId,
        userId,
        lastSeen: new Date().toISOString(),
      };
      this.io.to(`conv:${conversationId}`).emit('presence:leave', leavePayload);
    } else {
      userMap.set(userId, currentCount - 1);
    }
  }

  /**
   * Cleans up all presence rooms when a socket disconnects.
   */
  handleDisconnect(socket: AuthenticatedSocket): void {
    const socketId = socket.id;
    const conversations = this.socketRooms.get(socketId);
    if (!conversations) return;

    for (const conversationId of conversations) {
      this.handleLeave(socket, conversationId);
    }
    this.socketRooms.delete(socketId);
  }

  /** Gets active online users for a conversation room. */
  getOnlineUsers(conversationId: string): string[] {
    const userMap = this.rooms.get(conversationId);
    if (!userMap) return [];
    return Array.from(userMap.keys());
  }
}
