import type { AuthenticatedSocket } from '../middleware/socket-auth.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPING_DEBOUNCE_MS = 1000;

export interface TypingPayload {
  conversationId: string;
}

export interface TypingBroadcastPayload {
  conversationId: string;
  userId: string;
}

/**
 * Registers typing broadcast listeners with rate-limiting and room containment
 * (Spec §8.5; Roadmap Phase 12; Realtime-Design §8, §9, §14).
 */
export function registerTypingHandlers(socket: AuthenticatedSocket): void {
  let lastTypingTime = 0;

  socket.on('typing', (payload: TypingPayload) => {
    try {
      const conversationId = payload?.conversationId;
      if (!conversationId || !UUID_REGEX.test(conversationId)) {
        return;
      }

      const roomName = `conv:${conversationId}`;

      // 1. Verify socket is an authorized member of the room
      if (!socket.rooms.has(roomName)) {
        return;
      }

      // 2. Enforce per-socket debounce / rate-limit
      const now = Date.now();
      if (now - lastTypingTime < TYPING_DEBOUNCE_MS) {
        return;
      }
      lastTypingTime = now;

      // 3. Broadcast typing event to peers in room (excluding sender)
      const broadcastPayload: TypingBroadcastPayload = {
        conversationId,
        userId: socket.user.id,
      };
      socket.to(roomName).emit('typing', broadcastPayload);
    } catch {
      // Ephemeral error — ignore
    }
  });
}
