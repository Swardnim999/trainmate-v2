import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
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
import {
  EmailSender,
  VerificationEmailInput,
  PasswordResetEmailInput,
} from '../../src/utils/emails.js';

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

describe.skipIf(!canRunIntegration)('Message lifecycle — database-backed integration tests', () => {
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
  let app: Express;
  let emailSender: CapturingEmailSender;

  beforeEach(async () => {
    prisma = getTestPrisma();
    emailSender = new CapturingEmailSender();
    authService = await createTestAuthService(emailSender);
    moderationService = await createTestModerationService();

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

    conversationService = new ConversationService({
      conversations: new ConversationRepository(prisma),
      profiles: new ProfileRepository(prisma),
      access: accessService,
      db: prisma,
    });

    messageService = new MessageService({
      messages: new MessageRepository(prisma),
      lastRead: new LastReadRepository(prisma),
      conversations: new ConversationRepository(prisma),
      profiles: new ProfileRepository(prisma),
      access: accessService,
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
  });

  /** Helper to register a confirmed user and return token + userId */
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

  describe('1. Message Send & History Retrieval', () => {
    it('allows participant to send text message and retrieves in history (created_at ASC)', async () => {
      const userA = await createConfirmedUser('msg.a1@example.com');
      const userB = await createConfirmedUser('msg.b1@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const sendRes = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: 'Hello from coach B3!',
        });

      expect(sendRes.status).toBe(201);
      expect(sendRes.body.id).toBeDefined();
      expect(sendRes.body.text).toBe('Hello from coach B3!');
      expect(sendRes.body.senderId).toBe(userA.id);
      expect(sendRes.body.conversationId).toBe(conv.id);

      // Verify conversation preview was atomically bumped
      const updatedConv = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(updatedConv?.lastMessage).toBe('Hello from coach B3!');

      // Retrieve history as user B
      const listRes = await request(app)
        .get(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(sendRes.body.id);
      expect(listRes.body[0].text).toBe('Hello from coach B3!');
    });

    it('enforces chronological ordering (created_at ASC)', async () => {
      const userA = await createConfirmedUser('msg.a2@example.com');
      const userB = await createConfirmedUser('msg.b2@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Message 1' });

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ text: 'Message 2' });

      const listRes = await request(app)
        .get(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body).toHaveLength(2);
      expect(listRes.body[0].text).toBe('Message 1');
      expect(listRes.body[1].text).toBe('Message 2');
    });
  });

  describe('2. Authorization & Existence Masking', () => {
    it('masks existence with 404 when non-participant attempts to send message', async () => {
      const userA = await createConfirmedUser('msg.a3@example.com');
      const userB = await createConfirmedUser('msg.b3@example.com');
      const userC = await createConfirmedUser('msg.c3@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userC.token}`)
        .send({ text: 'Intruder message' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('masks existence with 404 when non-participant attempts to read messages', async () => {
      const userA = await createConfirmedUser('msg.a4@example.com');
      const userB = await createConfirmedUser('msg.b4@example.com');
      const userC = await createConfirmedUser('msg.c4@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const res = await request(app)
        .get(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userC.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('forces sender ID to authenticated caller (rejects client-supplied spoofed senderId)', async () => {
      const userA = await createConfirmedUser('msg.a5@example.com');
      const userB = await createConfirmedUser('msg.b5@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: 'Legit message',
          sender_id: userB.id, // Attempt to spoof User B
          senderId: userB.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.senderId).toBe(userA.id); // Must be User A
    });

    it('rejects sending message when participants are symmetrically blocked (400 USER_BLOCKED)', async () => {
      const userA = await createConfirmedUser('msg.a6@example.com');
      const userB = await createConfirmedUser('msg.b6@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      await prisma.blockedUser.create({
        data: {
          blockerId: userA.id,
          blockedId: userB.id,
        },
      });

      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Blocked message' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('USER_BLOCKED');
    });
  });

  describe('3. Attachments & BigInt Handling', () => {
    it('sends attachment-only message with empty text and handles BigInt size safely', async () => {
      const userA = await createConfirmedUser('msg.a7@example.com');
      const userB = await createConfirmedUser('msg.b7@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: '',
          attachment_url: 'https://storage.example.com/chat-attachments/convId/ticket.pdf',
          attachment_type: 'application/pdf',
          attachment_name: 'ticket.pdf',
          attachment_size: 1048576,
        });

      expect(res.status).toBe(201);
      expect(res.body.attachmentUrl).toBe(
        'https://storage.example.com/chat-attachments/convId/ticket.pdf',
      );
      expect(res.body.attachmentType).toBe('application/pdf');
      expect(res.body.attachmentSize).toBe(1048576);

      // Verify conversation preview reflects attachment
      const updatedConv = await prisma.conversation.findUnique({
        where: { id: conv.id },
      });
      expect(updatedConv?.lastMessage).toBe('📎 ticket.pdf');
    });

    it('rejects disallowed MIME types (SVG, HTML)', async () => {
      const userA = await createConfirmedUser('msg.a8@example.com');
      const userB = await createConfirmedUser('msg.b8@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const svgRes = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: '',
          attachmentUrl: 'https://example.com/file.svg',
          attachmentType: 'image/svg+xml',
        });
      expect(svgRes.status).toBe(400);

      const htmlRes = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: '',
          attachmentUrl: 'https://example.com/file.html',
          attachmentType: 'text/html',
        });
      expect(htmlRes.status).toBe(400);
    });

    it('rejects attachments larger than 10MB', async () => {
      const userA = await createConfirmedUser('msg.a9@example.com');
      const userB = await createConfirmedUser('msg.b9@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const res = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          text: '',
          attachmentUrl: 'https://example.com/huge.pdf',
          attachmentType: 'application/pdf',
          attachmentSize: 11 * 1024 * 1024,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('4. Read Receipts & Unread Counts', () => {
    it('tracks unread counts and updates last_read receipt upon markAsRead', async () => {
      const userA = await createConfirmedUser('msg.a10@example.com');
      const userB = await createConfirmedUser('msg.b10@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      // User A sends 2 messages
      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Msg 1' });

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Msg 2' });

      // User B checks unread count -> 2
      const unreadRes1 = await request(app)
        .get(`/conversations/${conv.id}/messages/unread-count`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(unreadRes1.status).toBe(200);
      expect(unreadRes1.body.count).toBe(2);

      // User B marks as read
      const markRes = await request(app)
        .put(`/conversations/${conv.id}/last-read`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(markRes.status).toBe(200);
      expect(markRes.body.timestamp).toBeDefined();

      // User B checks unread count again -> 0
      const unreadRes2 = await request(app)
        .get(`/conversations/${conv.id}/messages/unread-count`)
        .set('Authorization', `Bearer ${userB.token}`);

      expect(unreadRes2.status).toBe(200);
      expect(unreadRes2.body.count).toBe(0);

      // User A queries User B's last_read receipt
      const lrRes = await request(app)
        .get(`/conversations/${conv.id}/last-read/${userB.id}`)
        .set('Authorization', `Bearer ${userA.token}`);

      expect(lrRes.status).toBe(200);
      expect(lrRes.body.timestamp).toBe(markRes.body.timestamp);
    });
  });

  describe('5. Cascade Deletion & Email Privacy', () => {
    it('deleting conversation cascade-deletes messages and last_read rows', async () => {
      const userA = await createConfirmedUser('msg.a11@example.com');
      const userB = await createConfirmedUser('msg.b11@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Msg to cascade' });

      await request(app)
        .put(`/conversations/${conv.id}/last-read`)
        .set('Authorization', `Bearer ${userB.token}`);

      // Hard delete conversation
      await prisma.conversation.delete({ where: { id: conv.id } });

      const msgCount = await prisma.message.count({
        where: { conversationId: conv.id },
      });
      expect(msgCount).toBe(0);

      const lrCount = await prisma.lastRead.count({
        where: { conversationId: conv.id },
      });
      expect(lrCount).toBe(0);
    });

    it('strictly preserves email privacy (no email in responses)', async () => {
      const userA = await createConfirmedUser('msg.a12@example.com');
      const userB = await createConfirmedUser('msg.b12@example.com');
      const conv = await createTestConversation(userA.id, userB.id);

      const sendRes = await request(app)
        .post(`/conversations/${conv.id}/messages`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ text: 'Privacy test' });

      const jsonStr = JSON.stringify(sendRes.body);
      expect(jsonStr).not.toContain('msg.a12@example.com');
      expect(jsonStr).not.toContain('email');
    });
  });
});
