/**
 * TrainMate v2 — Socket.IO Client Manager
 */

import { io, Socket } from 'socket.io-client';
import { getStoredSession } from '../../lib/api/client';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  PresenceUser,
  TypingPayload,
  LastReadUpdatePayload,
  ConversationUpdatedPayload,
  CompanionsUpdatedPayload,
} from './types';
import { Message, CompanionRequest } from '../../lib/api/types';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL || 'http://localhost:3000';

class SocketManager {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
  private currentToken: string | null = null;

  connect(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    const session = getStoredSession();
    const token = session?.access_token || null;

    if (!token) {
      this.disconnect();
      return null;
    }

    if (this.socket && this.currentToken === token && this.socket.connected) {
      return this.socket;
    }

    if (this.socket) {
      this.socket.disconnect();
    }

    this.currentToken = token;
    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });

    return this.socket;
  }

  getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
    if (!this.socket || !this.socket.connected) {
      return this.connect();
    }
    return this.socket;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.currentToken = null;
    }
  }

  joinConversation(conversationId: string): void {
    const s = this.getSocket();
    if (s) {
      s.emit('join:conversation', { conversationId });
    }
  }

  leaveConversation(conversationId: string): void {
    const s = this.getSocket();
    if (s) {
      s.emit('leave:conversation', { conversationId });
    }
  }

  onMessage(handler: (message: Message) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('message:new', handler);
    return () => {
      s.off('message:new', handler);
    };
  }

  onLastRead(handler: (payload: LastReadUpdatePayload) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('last-read:update', handler);
    return () => {
      s.off('last-read:update', handler);
    };
  }

  onConversationUpdated(handler: (payload: ConversationUpdatedPayload) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('conversation:updated', handler);
    return () => {
      s.off('conversation:updated', handler);
    };
  }

  joinPresence(channel: string, metadata?: Record<string, unknown>): void {
    const s = this.getSocket();
    if (s) {
      s.emit('presence:join', { channel, metadata });
    }
  }

  leavePresence(channel: string): void {
    const s = this.getSocket();
    if (s) {
      s.emit('presence:leave', { channel });
    }
  }

  onPresenceSync(handler: (users: PresenceUser[]) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('presence:sync', handler);
    return () => {
      s.off('presence:sync', handler);
    };
  }

  onPresenceJoin(handler: (user: PresenceUser) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('presence:join', handler);
    return () => {
      s.off('presence:join', handler);
    };
  }

  onPresenceLeave(handler: (user: PresenceUser) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('presence:leave', handler);
    return () => {
      s.off('presence:leave', handler);
    };
  }

  sendTyping(conversationId: string, isTyping: boolean): void {
    const s = this.getSocket();
    if (s) {
      s.emit('typing', { conversationId, isTyping });
    }
  }

  onTyping(handler: (payload: TypingPayload) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('typing', handler);
    return () => {
      s.off('typing', handler);
    };
  }

  onRequestNew(handler: (request: CompanionRequest) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('request:new', handler);
    return () => {
      s.off('request:new', handler);
    };
  }

  onRequestUpdated(handler: (request: CompanionRequest) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('request:updated', handler);
    return () => {
      s.off('request:updated', handler);
    };
  }

  onCompanionsUpdated(handler: (payload?: CompanionsUpdatedPayload) => void): () => void {
    const s = this.getSocket();
    if (!s) return () => {};
    s.on('companions:updated', handler);
    return () => {
      s.off('companions:updated', handler);
    };
  }
}

export const socketManager = new SocketManager();
