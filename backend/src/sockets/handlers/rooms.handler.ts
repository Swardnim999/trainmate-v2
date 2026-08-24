import type { AuthenticatedSocket } from '../middleware/socket-auth.js';
import type { ConversationRepository } from '../../repositories/conversations.repo.js';
import type { PresenceCoordinator } from '../presence.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JoinRoomPayload {
  conversationId: string;
}

export interface LeaveRoomPayload {
  conversationId: string;
}

/**
 * Registers room join/leave listeners with participant authorization
 * (Spec §8.5; Roadmap Phase 12; Realtime-Design §7, §10).
 */
export function registerRoomHandlers(
  socket: AuthenticatedSocket,
  conversationsRepo: ConversationRepository,
  presence: PresenceCoordinator,
): void {
  socket.on(
    'join:conversation',
    async (
      payload: JoinRoomPayload,
      callback?: (response: { success: boolean; error?: string }) => void,
    ) => {
      try {
        const conversationId = payload?.conversationId;
        if (!conversationId || !UUID_REGEX.test(conversationId)) {
          const err = { success: false, error: 'Invalid conversation ID' };
          callback?.(err);
          socket.emit('error', { code: 'VALIDATION_ERROR', message: 'Invalid conversation ID' });
          return;
        }

        const conv = await conversationsRepo.findById(conversationId);
        if (!conv || !conv.participants.includes(socket.user.id)) {
          const err = { success: false, error: 'Conversation not found' };
          callback?.(err);
          socket.emit('error', { code: 'NOT_FOUND', message: 'Conversation not found' });
          return;
        }

        // Authorize and join room
        const roomName = `conv:${conversationId}`;
        await socket.join(roomName);
        presence.handleJoin(socket, conversationId);

        callback?.({ success: true });
      } catch {
        callback?.({ success: false, error: 'Failed to join conversation room' });
      }
    },
  );

  socket.on(
    'leave:conversation',
    async (payload: LeaveRoomPayload, callback?: (response: { success: boolean }) => void) => {
      try {
        const conversationId = payload?.conversationId;
        if (conversationId && UUID_REGEX.test(conversationId)) {
          const roomName = `conv:${conversationId}`;
          await socket.leave(roomName);
          presence.handleLeave(socket, conversationId);
        }
        callback?.({ success: true });
      } catch {
        callback?.({ success: true });
      }
    },
  );
}
