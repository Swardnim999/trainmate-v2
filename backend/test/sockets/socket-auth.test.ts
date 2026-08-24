import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';
import { createSocketAuthMiddleware } from '../../src/sockets/middleware/socket-auth.js';
import type { JwtService } from '../../src/utils/jwt.js';

describe('Socket Auth Middleware (Unit)', () => {
  let mockJwt: {
    verify: ReturnType<typeof vi.fn>;
  };
  let middleware: ReturnType<typeof createSocketAuthMiddleware>;

  beforeEach(() => {
    mockJwt = {
      verify: vi.fn(),
    };
    middleware = createSocketAuthMiddleware(mockJwt as unknown as JwtService);
  });

  it('authenticates valid token from auth payload', async () => {
    mockJwt.verify.mockResolvedValue({
      sub: '00000000-0000-4000-8000-000000000001',
      email: 'alex@example.com',
    });

    const socket = {
      handshake: {
        auth: { token: 'valid-token' },
        headers: {},
      },
    } as unknown as Socket;

    const next = vi.fn();
    await middleware(socket, next);

    expect(mockJwt.verify).toHaveBeenCalledWith('valid-token');
    expect((socket as unknown as AuthenticatedSocket).user).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      email: 'alex@example.com',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('authenticates valid token from authorization header', async () => {
    mockJwt.verify.mockResolvedValue({
      sub: '00000000-0000-4000-8000-000000000002',
      email: 'bob@example.com',
    });

    const socket = {
      handshake: {
        auth: {},
        headers: { authorization: 'Bearer header-token' },
      },
    } as unknown as Socket;

    const next = vi.fn();
    await middleware(socket, next);

    expect(mockJwt.verify).toHaveBeenCalledWith('header-token');
    expect((socket as unknown as AuthenticatedSocket).user).toEqual({
      id: '00000000-0000-4000-8000-000000000002',
      email: 'bob@example.com',
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects connection when no token is provided', async () => {
    const socket = {
      handshake: {
        auth: {},
        headers: {},
      },
    } as unknown as Socket;

    const next = vi.fn();
    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'AUTHENTICATION_REQUIRED',
        data: expect.objectContaining({ code: 'UNAUTHORIZED' }),
      }),
    );
  });

  it('rejects connection when token is invalid or expired', async () => {
    mockJwt.verify.mockRejectedValue(new Error('jwt expired'));

    const socket = {
      handshake: {
        auth: { token: 'expired-token' },
        headers: {},
      },
    } as unknown as Socket;

    const next = vi.fn();
    await middleware(socket, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'TOKEN_INVALID_OR_EXPIRED',
        data: expect.objectContaining({ code: 'UNAUTHORIZED' }),
      }),
    );
  });
});
