import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerTypingHandlers } from '../../src/sockets/handlers/typing.handler.js';
import type { AuthenticatedSocket } from '../../src/sockets/middleware/socket-auth.js';

describe('Typing Handler (Unit)', () => {
  let mockSocket: {
    user: { id: string; email: string };
    rooms: Set<string>;
    to: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  let mockRoomEmitter: {
    emit: ReturnType<typeof vi.fn>;
  };

  const convId = 'c1111111-1111-4111-8111-111111111111';
  const user1 = '00000000-0000-4000-8000-000000000001';

  const listeners: Record<string, (...args: unknown[]) => unknown> = {};

  beforeEach(() => {
    mockRoomEmitter = {
      emit: vi.fn(),
    };
    mockSocket = {
      user: { id: user1, email: 'alex@example.com' },
      rooms: new Set([`conv:${convId}`]),
      to: vi.fn().mockReturnValue(mockRoomEmitter),
      on: vi.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };

    registerTypingHandlers(mockSocket as unknown as AuthenticatedSocket);
  });

  it('broadcasts typing event to peers in room', () => {
    listeners['typing']({ conversationId: convId });

    expect(mockSocket.to).toHaveBeenCalledWith(`conv:${convId}`);
    expect(mockRoomEmitter.emit).toHaveBeenCalledWith('typing', {
      conversationId: convId,
      userId: user1,
    });
  });

  it('ignores typing event if socket is not in the conversation room', () => {
    mockSocket.rooms.clear(); // not in room

    listeners['typing']({ conversationId: convId });

    expect(mockSocket.to).not.toHaveBeenCalled();
    expect(mockRoomEmitter.emit).not.toHaveBeenCalled();
  });

  it('rate-limits typing events (drops events within 1000ms window)', () => {
    listeners['typing']({ conversationId: convId });
    expect(mockRoomEmitter.emit).toHaveBeenCalledTimes(1);

    // Immediate second event -> dropped by debounce
    listeners['typing']({ conversationId: convId });
    expect(mockRoomEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid conversation ID payload', () => {
    listeners['typing']({ conversationId: 'not-a-valid-uuid' });

    expect(mockSocket.to).not.toHaveBeenCalled();
    expect(mockRoomEmitter.emit).not.toHaveBeenCalled();
  });
});
