import type { Socket } from 'socket.io';
import type { JwtService } from '../../utils/jwt.js';

export interface AuthenticatedSocketUser {
  id: string;
  email: string;
}

export interface AuthenticatedSocket extends Socket {
  user: AuthenticatedSocketUser;
}

export interface SocketAuthError extends Error {
  data?: {
    code: string;
    message: string;
  };
}

/**
 * Socket.IO handshake authentication middleware (Spec §8.5; Roadmap Phase 12; Realtime-Design §5).
 * Validates JWT access token passed via `socket.handshake.auth.token` or `Authorization: Bearer <token>`.
 * Attaches verified `socket.user = { id: sub, email }` on success.
 * Rejects connection with descriptive SocketAuthError on failure.
 */
export function createSocketAuthMiddleware(jwtService: JwtService) {
  return async (socket: Socket, next: (err?: SocketAuthError) => void): Promise<void> => {
    try {
      const authPayload = socket.handshake.auth as { token?: string } | undefined;
      const authHeader = socket.handshake.headers.authorization;

      let rawToken: string | undefined = authPayload?.token;
      if (!rawToken && authHeader?.startsWith('Bearer ')) {
        rawToken = authHeader.slice(7).trim();
      }

      if (!rawToken) {
        const error = new Error('AUTHENTICATION_REQUIRED') as SocketAuthError;
        error.data = { code: 'UNAUTHORIZED', message: 'No authentication token provided' };
        return next(error);
      }

      const payload = await jwtService.verify(rawToken);
      (socket as AuthenticatedSocket).user = {
        id: payload.sub,
        email: payload.email,
      };

      next();
    } catch {
      const error = new Error('TOKEN_INVALID_OR_EXPIRED') as SocketAuthError;
      error.data = {
        code: 'UNAUTHORIZED',
        message: 'Authentication token is invalid or expired',
      };
      next(error);
    }
  };
}
