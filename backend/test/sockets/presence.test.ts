import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import { PresenceCoordinator } from '../../src/sockets/presence.js';
import type { AuthenticatedSocket } from '../../src/sockets/middleware/socket-auth.js';

describe('PresenceCoordinator (Unit)', () => {
  let mockIo: {
    to: ReturnType<typeof vi.fn>;
  };
  let mockRoomEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };
  let presence: PresenceCoordinator;

  const convId = 'c1111111-1111-4111-8111-111111111111';
  const user1 = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    mockRoomEmitter = {
      emit: vi.fn(),
    };
    mockIo = {
      to: vi.fn().mockReturnValue(mockRoomEmitter),
    };
    presence = new PresenceCoordinator(mockIo as unknown as SocketIOServer);
  });

  it('emits presence:sync to joining socket and presence:join to room on first connection', () => {
    const mockSocket = {
      id: 'socket-1',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    presence.handleJoin(mockSocket, convId);

    expect(mockSocket.emit).toHaveBeenCalledWith('presence:sync', {
      conversationId: convId,
      users: { [user1]: { online: true } },
    });

    expect(mockIo.to).toHaveBeenCalledWith(`conv:${convId}`);
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith('presence:join', {
      conversationId: convId,
      userId: user1,
    });
  });

  it('collapses multi-tab connections (does not broadcast duplicate join)', () => {
    const socketTab1 = {
      id: 'socket-tab-1',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    const socketTab2 = {
      id: 'socket-tab-2',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    presence.handleJoin(socketTab1, convId);
    expect(mockRoomEmitter.emit).toHaveBeenCalledTimes(1);

    presence.handleJoin(socketTab2, convId);
    // presence:join should NOT be broadcast a second time for same user
    expect(mockRoomEmitter.emit).toHaveBeenCalledTimes(1);
    expect(socketTab2.emit).toHaveBeenCalledWith('presence:sync', {
      conversationId: convId,
      users: { [user1]: { online: true } },
    });
  });

  it('broadcasts presence:leave when last socket for user disconnects', () => {
    const socketTab1 = {
      id: 'socket-tab-1',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    const socketTab2 = {
      id: 'socket-tab-2',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    presence.handleJoin(socketTab1, convId);
    presence.handleJoin(socketTab2, convId);

    // Close tab 1 -> user still online via tab 2, no presence:leave
    presence.handleLeave(socketTab1, convId);
    expect(mockRoomEmitter.emit).not.toHaveBeenCalledWith('presence:leave', expect.anything());

    // Close tab 2 -> now user has 0 sockets -> presence:leave is broadcast
    presence.handleLeave(socketTab2, convId);
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith(
      'presence:leave',
      expect.objectContaining({
        conversationId: convId,
        userId: user1,
        lastSeen: expect.any(String),
      }),
    );
  });

  it('handleDisconnect cleans up all rooms for disconnecting socket', () => {
    const socket = {
      id: 'socket-disc',
      user: { id: user1, email: 'alex@example.com' },
      emit: vi.fn(),
    } as unknown as AuthenticatedSocket;

    presence.handleJoin(socket, convId);
    presence.handleDisconnect(socket);

    expect(mockRoomEmitter.emit).toHaveBeenCalledWith(
      'presence:leave',
      expect.objectContaining({
        conversationId: convId,
        userId: user1,
      }),
    );
  });
});
