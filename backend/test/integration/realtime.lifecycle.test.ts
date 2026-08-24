import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createServer, type Server as HttpServer } from 'node:http';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { initSocketServer, type SocketServerResult } from '../../src/sockets/index.js';
import {
  getTestPrisma,
  createTestAuthService,
  createTestModerationService,
  canRunIntegration,
} from '../setup.integration.js';
import { AuthService } from '../../src/services/auth.service.js';
import { ModerationService } from '../../src/services/moderation.service.js';
import { AccessService } from '../../src/services/access.service.js';
import { ProfileService } from '../../src/services/profile.service.js';
import { JourneyService } from '../../src/services/journey.service.js';
import { TrainService } from '../../src/services/train.service.js';
import { RequestService } from '../../src/services/request.service.js';
import { ConversationService } from '../../src/services/conversation.service.js';
import { MessageService } from '../../src/services/message.service.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';
import {
  EmailSender,
  VerificationEmailInput,
  PasswordResetEmailInput,
} from '../../src/utils/emails.js';

import type { Express } from 'express';
import type { SerializedMessage } from '../../src/serializers/message.serializer.js';
import type { SerializedConversation } from '../../src/serializers/conversation.serializer.js';
import type {
  PresenceJoinPayload,
  PresenceLeavePayload,
  PresenceSyncPayload,
} from '../../src/sockets/presence.js';
import type { LastReadUpdatePayload } from '../../src/sockets/broadcaster.js';
import type { TypingBroadcastPayload } from '../../src/sockets/handlers/typing.handler.js';

class CapturingEmailSender implements EmailSender {
  public lastVerificationToken: string | null = null;
  public lastResetToken: string | null = null;

  async sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
    this.lastVerificationToken = input.token;
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    this.lastResetToken = input.token;
  }
}

describe.skipIf(!canRunIntegration)('Realtime / Socket.IO lifecycle — integration tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let moderationService: ModerationService;
  let accessService: AccessService;
  let profileService: ProfileService;
  let journeyService: JourneyService;
  let trainService: TrainService;
  let requestService: RequestService;
  let conversationService: ConversationService;
  let messageService: MessageService;
  let jwtService: JwtService;
  let emailSender: CapturingEmailSender;

  let httpServer: HttpServer;
  let socketServer: SocketServerResult;
  let serverPort: number;
  let app: Express;

  const openSockets: ClientSocket[] = [];

  beforeEach(async () => {
    prisma = getTestPrisma();
    emailSender = new CapturingEmailSender();
    authService = await createTestAuthService(emailSender);
    moderationService = await createTestModerationService();
    jwtService = new JwtService(env.JWT_SECRET);

    const { BlockedUserRepository } = await import('../../src/repositories/blocked-users.repo.js');
    const { ProfileRepository } = await import('../../src/repositories/profiles.repo.js');
    const { UserRepository } = await import('../../src/repositories/users.repo.js');
    const { JourneyRepository } = await import('../../src/repositories/journeys.repo.js');
    const { TrainRepository } = await import('../../src/repositories/trains.repo.js');
    const { UnverifiedTrainRepository } =
      await import('../../src/repositories/unverified-trains.repo.js');
    const { RequestRepository } = await import('../../src/repositories/requests.repo.js');
    const { ConversationRepository } = await import('../../src/repositories/conversations.repo.js');
    const { MessageRepository } = await import('../../src/repositories/messages.repo.js');
    const { LastReadRepository } = await import('../../src/repositories/last-read.repo.js');

    accessService = new AccessService({
      blockedUsers: new BlockedUserRepository(prisma),
      db: prisma,
    });

    profileService = new ProfileService({
      profiles: new ProfileRepository(prisma),
      users: new UserRepository(prisma),
      access: accessService,
    });

    journeyService = new JourneyService({
      journeys: new JourneyRepository(prisma),
      trains: new TrainRepository(prisma),
      unverifiedTrains: new UnverifiedTrainRepository(prisma),
      profiles: new ProfileRepository(prisma),
      access: accessService,
      db: prisma,
    });

    trainService = new TrainService({
      trainRepo: new TrainRepository(prisma),
      unverifiedRepo: new UnverifiedTrainRepository(prisma),
    });

    requestService = new RequestService({
      requests: new RequestRepository(prisma),
      access: accessService,
      db: prisma,
    });

    const conversationsRepo = new ConversationRepository(prisma);

    httpServer = createServer();

    socketServer = initSocketServer({
      httpServer,
      jwtService,
      conversationsRepo,
      corsOrigin: '*',
    });

    conversationService = new ConversationService({
      conversations: conversationsRepo,
      profiles: new ProfileRepository(prisma),
      access: accessService,
      broadcaster: socketServer.broadcaster,
      db: prisma,
    });

    messageService = new MessageService({
      messages: new MessageRepository(prisma),
      lastRead: new LastReadRepository(prisma),
      conversations: conversationsRepo,
      profiles: new ProfileRepository(prisma),
      access: accessService,
      broadcaster: socketServer.broadcaster,
      db: prisma,
    });

    app = createApp({
      auth: authService,
      moderation: moderationService,
      profileService,
      journeyService,
      trainService,
      requestService,
      conversationService,
      messageService,
    });

    httpServer.on('request', app);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (typeof addr === 'object' && addr) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const socket of openSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    openSockets.length = 0;

    await new Promise<void>((resolve) => {
      socketServer.io.close(() => {
        httpServer.close(() => resolve());
      });
    });
  });

  /** Helper to register a user and return userId + access token */
  async function createConfirmedUser(
    email: string,
    password = 'Password123!',
  ): Promise<{ id: string; token: string }> {
    const registerRes = await request(app).post('/auth/register').send({ email, password });
    expect(registerRes.status).toBe(200);
    const userId = registerRes.body.user.id;

    const token = emailSender.lastVerificationToken;
    expect(token).toBeDefined();
    const confirmRes = await request(app).post('/auth/confirm-email').send({ token });
    expect(confirmRes.status).toBe(200);

    const loginRes = await request(app).post('/auth/login').send({ email, password });
    expect(loginRes.status).toBe(200);

    return { id: userId, token: loginRes.body.access_token };
  }

  /** Helper to connect a Socket.IO client */
  function connectSocket(token?: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${serverPort}`, {
        auth: token ? { token } : undefined,
        transports: ['websocket'],
        reconnection: false,
        timeout: 5000,
      });

      openSockets.push(socket);

      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  }

  async function createTestConversation(userAId: string, userBId: string) {
    return prisma.conversation.create({
      data: {
        participants: [userAId, userBId],
        participantNames: { [userAId]: 'Alice', [userBId]: 'Bob' },
        trainNumber: '12951',
        travelDate: new Date('2026-09-15T00:00:00.000Z'),
      },
    });
  }

  describe('1. Handshake Authentication', () => {
    it('connects successfully with a valid access token', async () => {
      const user = await createConfirmedUser('rt.auth1@example.com');
      const socket = await connectSocket(user.token);

      expect(socket.connected).toBe(true);
    });

    it('rejects connection without token (AUTHENTICATION_REQUIRED)', async () => {
      await expect(connectSocket()).rejects.toThrow();
    });

    it('rejects connection with invalid token (TOKEN_INVALID_OR_EXPIRED)', async () => {
      await expect(connectSocket('invalid-jwt-token')).rejects.toThrow();
    });

    it('rejects connection with expired JWT token', async () => {
      const expiredToken = await jwtService.sign(
        { id: '00000000-0000-4000-8000-000000000001', email: 'exp@example.com' },
        new Date(Date.now() - 3600_000),
        60,
      );

      await expect(connectSocket(expiredToken)).rejects.toThrow();
    });
  });

  describe('2. Room Authorization & Participant Joins', () => {
    it('allows verified participant to join conversation room', async () => {
      const userA = await createConfirmedUser('rt.room1@example.com');
      const userB = await createConfirmedUser('rt.room2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);

      const joinAck = await new Promise<{ success: boolean }>((resolve) => {
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve);
      });

      expect(joinAck.success).toBe(true);
    });

    it('rejects non-participant attempting to join conversation room (404 NOT_FOUND)', async () => {
      const userA = await createConfirmedUser('rt.room3@example.com');
      const userB = await createConfirmedUser('rt.room4@example.com');
      const userC = await createConfirmedUser('rt.room5@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketC = await connectSocket(userC.token);

      const joinAck = await new Promise<{ success: boolean; error?: string }>((resolve) => {
        socketC.emit('join:conversation', { conversationId: conv.id }, resolve);
      });

      expect(joinAck.success).toBe(false);
      expect(joinAck.error).toBe('Conversation not found');
    });
  });

  describe('3. Message & Read Receipt Broadcasts', () => {
    it('broadcasts message:new to both sender (echo) and recipient upon HTTP send', async () => {
      const userA = await createConfirmedUser('rt.msg1@example.com');
      const userB = await createConfirmedUser('rt.msg2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      const socketB = await connectSocket(userB.token);

      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve),
      );
      await new Promise((resolve) =>
        socketB.emit('join:conversation', { conversationId: conv.id }, resolve),
      );

      const messageAEvent = new Promise<SerializedMessage>((resolve) =>
        socketA.once('message:new', resolve),
      );
      const messageBEvent = new Promise<SerializedMessage>((resolve) =>
        socketB.once('message:new', resolve),
      );

      // User A posts message via HTTP REST
      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Realtime message test!' });

      expect(res.status).toBe(201);

      const eventA = await messageAEvent;
      const eventB = await messageBEvent;

      expect(eventA.id).toBe(res.body.id);
      expect(eventA.text).toBe('Realtime message test!');
      expect(eventA.senderId).toBe(userA.id);

      expect(eventB.id).toBe(res.body.id);
      expect(eventB.text).toBe('Realtime message test!');
    });

    it('broadcasts last-read:update to conversation room upon HTTP markAsRead', async () => {
      const userA = await createConfirmedUser('rt.lr1@example.com');
      const userB = await createConfirmedUser('rt.lr2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      const socketB = await connectSocket(userB.token);

      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve),
      );
      await new Promise((resolve) =>
        socketB.emit('join:conversation', { conversationId: conv.id }, resolve),
      );

      const lastReadUpdateEvent = new Promise<LastReadUpdatePayload>((resolve) =>
        socketA.once('last-read:update', resolve),
      );

      // User B marks conversation as read via HTTP REST
      await request(app)
        .put(`/conversations/${conv.id}/last-read`)
        .set('Authorization', `Bearer ${userB.token}`);

      const event = await lastReadUpdateEvent;
      expect(event.userId).toBe(userB.id);
      expect(event.conversationId).toBe(conv.id);
      expect(event.timestamp).toBeDefined();
    });

    it('broadcasts conversation:updated to participant user rooms upon message send', async () => {
      const userA = await createConfirmedUser('rt.cu1@example.com');
      const userB = await createConfirmedUser('rt.cu2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      const socketB = await connectSocket(userB.token);

      const convUpdatedA = new Promise<SerializedConversation>((resolve) =>
        socketA.once('conversation:updated', resolve),
      );
      const convUpdatedB = new Promise<SerializedConversation>((resolve) =>
        socketB.once('conversation:updated', resolve),
      );

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Preview bump realtime' });

      const eventA = await convUpdatedA;
      const eventB = await convUpdatedB;

      expect(eventA.id).toBe(conv.id);
      expect(eventA.lastMessage).toBe('Preview bump realtime');
      expect(eventB.id).toBe(conv.id);
      expect(eventB.lastMessage).toBe('Preview bump realtime');
    });
  });

  describe('4. Presence & Typing Broadcasts', () => {
    it('manages presence:sync and broadcasts presence:join / presence:leave', async () => {
      const userA = await createConfirmedUser('rt.pres1@example.com');
      const userB = await createConfirmedUser('rt.pres2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve),
      );

      const socketB = await connectSocket(userB.token);

      const joinEventForA = new Promise<PresenceJoinPayload>((resolve) =>
        socketA.once('presence:join', resolve),
      );
      const syncEventForB = new Promise<PresenceSyncPayload>((resolve) =>
        socketB.once('presence:sync', resolve),
      );

      // User B joins room
      socketB.emit('join:conversation', { conversationId: conv.id });

      const joinEvent = await joinEventForA;
      expect(joinEvent.userId).toBe(userB.id);

      const syncEvent = await syncEventForB;
      expect(syncEvent.users[userA.id]?.online).toBe(true);
      expect(syncEvent.users[userB.id]?.online).toBe(true);

      // User B leaves room
      const leaveEventForA = new Promise<PresenceLeavePayload>((resolve) =>
        socketA.once('presence:leave', resolve),
      );
      socketB.emit('leave:conversation', { conversationId: conv.id });

      const leaveEvent = await leaveEventForA;
      expect(leaveEvent.userId).toBe(userB.id);
    });

    it('broadcasts typing indicator to peers in room and excludes sender', async () => {
      const userA = await createConfirmedUser('rt.type1@example.com');
      const userB = await createConfirmedUser('rt.type2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      const socketB = await connectSocket(userB.token);

      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve),
      );
      await new Promise((resolve) =>
        socketB.emit('join:conversation', { conversationId: conv.id }, resolve),
      );

      const typingEventForB = new Promise<TypingBroadcastPayload>((resolve) =>
        socketB.once('typing', resolve),
      );

      let senderReceivedTyping = false;
      socketA.once('typing', () => {
        senderReceivedTyping = true;
      });

      // User A emits typing
      socketA.emit('typing', { conversationId: conv.id });

      const event = await typingEventForB;
      expect(event.conversationId).toBe(conv.id);
      expect(event.userId).toBe(userA.id);
      expect(senderReceivedTyping).toBe(false);
    });
  });

  describe('5. Cross-Room Isolation & Email Privacy', () => {
    it('guarantees cross-conversation isolation (no event leakage to other rooms)', async () => {
      const userA = await createConfirmedUser('rt.iso1@example.com');
      const userB = await createConfirmedUser('rt.iso2@example.com');
      const userC = await createConfirmedUser('rt.iso3@example.com');
      const userD = await createConfirmedUser('rt.iso4@example.com');

      const convAB = await createTestConversation(userA.id, userB.id);
      const convCD = await createTestConversation(userC.id, userD.id);

      const socketA = await connectSocket(userA.token);
      const socketC = await connectSocket(userC.token);

      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: convAB.id }, resolve),
      );
      await new Promise((resolve) =>
        socketC.emit('join:conversation', { conversationId: convCD.id }, resolve),
      );

      let userCReceivedMessage = false;
      socketC.on('message:new', () => {
        userCReceivedMessage = true;
      });

      // User A sends message in convAB
      await request(app)
        .post(`/conversations/${convAB.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Secret message for B' });

      // Wait a short tick
      await new Promise((r) => setTimeout(r, 100));

      expect(userCReceivedMessage).toBe(false);
    });

    it('strictly preserves email privacy across all event payloads', async () => {
      const userA = await createConfirmedUser('rt.priv1@example.com');
      const userB = await createConfirmedUser('rt.priv2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const socketA = await connectSocket(userA.token);
      const socketB = await connectSocket(userB.token);

      await new Promise((resolve) =>
        socketA.emit('join:conversation', { conversationId: conv.id }, resolve),
      );
      await new Promise((resolve) =>
        socketB.emit('join:conversation', { conversationId: conv.id }, resolve),
      );

      const messageEvent = new Promise<SerializedMessage>((resolve) =>
        socketB.once('message:new', resolve),
      );
      const convEvent = new Promise<SerializedConversation>((resolve) =>
        socketB.once('conversation:updated', resolve),
      );

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Privacy test realtime' });

      const msg = await messageEvent;
      const cu = await convEvent;

      expect(JSON.stringify(msg)).not.toContain('rt.priv1@example.com');
      expect(JSON.stringify(msg)).not.toContain('email');
      expect(JSON.stringify(cu)).not.toContain('rt.priv1@example.com');
      expect(JSON.stringify(cu)).not.toContain('email');
    });
  });
});
