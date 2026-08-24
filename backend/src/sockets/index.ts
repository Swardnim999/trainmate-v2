import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { createSocketAuthMiddleware, type AuthenticatedSocket } from './middleware/socket-auth.js';
import { registerRoomHandlers } from './handlers/rooms.handler.js';
import { registerTypingHandlers } from './handlers/typing.handler.js';
import { RealtimeBroadcaster } from './broadcaster.js';
import { PresenceCoordinator } from './presence.js';
import type { JwtService } from '../utils/jwt.js';
import type { ConversationRepository } from '../repositories/conversations.repo.js';

export interface SocketsInitOptions {
  httpServer: HttpServer;
  jwtService: JwtService;
  conversationsRepo: ConversationRepository;
  corsOrigin: string | string[];
}

export interface SocketServerResult {
  io: SocketIOServer;
  broadcaster: RealtimeBroadcaster;
  presence: PresenceCoordinator;
}

/**
 * Initializes and mounts the Socket.IO server tier (Spec §8.5; Roadmap Phase 12; Realtime-Design §4).
 */
export function initSocketServer(options: SocketsInitOptions): SocketServerResult {
  const io = new SocketIOServer(options.httpServer, {
    cors: {
      origin: options.corsOrigin,
      credentials: true,
    },
    serveClient: false,
    pingInterval: 25000,
    pingTimeout: 20000,
    maxHttpBufferSize: 1e6, // 1 MB max frame size
  });

  // Attach Handshake Authentication
  io.use(createSocketAuthMiddleware(options.jwtService));

  const broadcaster = new RealtimeBroadcaster(io);
  const presence = new PresenceCoordinator(io);

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;

    // 1. Auto-join user-specific room
    socket.join(`user:${socket.user.id}`);

    // 2. Register room and typing handlers
    registerRoomHandlers(socket, options.conversationsRepo, presence);
    registerTypingHandlers(socket);

    // 3. Register disconnect cleanup
    socket.on('disconnect', () => {
      presence.handleDisconnect(socket);
    });
  });

  return { io, broadcaster, presence };
}

export * from './broadcaster.js';
export * from './presence.js';
export * from './middleware/socket-auth.js';
