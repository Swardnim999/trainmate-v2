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

describe.skipIf(!canRunIntegration)(
  'Conversation lifecycle — database-backed integration tests',
  () => {
    let prisma: PrismaClient;
    let authService: AuthService;
    let moderationService: ModerationService;
    let accessService: AccessService;
    let profileService: ProfileService;
    let journeyService: JourneyService;
    let trainService: TrainService;
    let requestService: RequestService;
    let conversationService: ConversationService;
    let app: Express;
    let emailSender: CapturingEmailSender;

    beforeEach(async () => {
      prisma = getTestPrisma();
      emailSender = new CapturingEmailSender();
      authService = await createTestAuthService(emailSender);
      moderationService = await createTestModerationService();

      const { BlockedUserRepository } =
        await import('../../src/repositories/blocked-users.repo.js');
      const { ProfileRepository } = await import('../../src/repositories/profiles.repo.js');
      const { UserRepository } = await import('../../src/repositories/users.repo.js');
      const { JourneyRepository } = await import('../../src/repositories/journeys.repo.js');
      const { TrainRepository } = await import('../../src/repositories/trains.repo.js');
      const { UnverifiedTrainRepository } =
        await import('../../src/repositories/unverified-trains.repo.js');
      const { RequestRepository } = await import('../../src/repositories/requests.repo.js');
      const { ConversationRepository } =
        await import('../../src/repositories/conversations.repo.js');

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

      app = createApp({
        auth: authService,
        moderation: moderationService,
        profileService,
        journeyService,
        trainService,
        requestService,
        conversationService,
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

    async function establishAcceptedRequest(
      fromId: string,
      toId: string,
      trainNumber = '12951',
      travelDate = new Date('2026-09-15T00:00:00.000Z'),
    ) {
      return prisma.request.create({
        data: {
          fromUserId: fromId,
          toUserId: toId,
          trainNumber,
          travelDate,
          status: 'accepted',
        },
      });
    }

    describe('1. Conversation Creation & Accepted-Request Authorization', () => {
      it('creates a conversation when an accepted request exists between participants', async () => {
        const userA = await createConfirmedUser('conv.a1@example.com');
        const userB = await createConfirmedUser('conv.b1@example.com');

        await establishAcceptedRequest(userA.id, userB.id);

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
            participant_names: {
              [userA.id]: 'Alice',
              [userB.id]: 'Bob',
            },
            train_number: '12951',
            travel_date: '2026-09-15',
          });

        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.participants).toEqual(expect.arrayContaining([userA.id, userB.id]));
        expect(res.body.trainNumber).toBe('12951');
        expect(res.body.travelDate).toBe('2026-09-15');
        expect(res.body.participantNames).toEqual({
          [userA.id]: 'Alice',
          [userB.id]: 'Bob',
        });

        // Verify in DB
        const dbConv = await prisma.conversation.findUnique({
          where: { id: res.body.id },
        });
        expect(dbConv).not.toBeNull();
        expect(dbConv?.participants).toEqual([userA.id, userB.id]);
      });

      it('rejects conversation creation with 403 when NO accepted request exists', async () => {
        const userA = await createConfirmedUser('conv.a2@example.com');
        const userB = await createConfirmedUser('conv.b2@example.com');

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
            train_number: '12951',
          });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('NO_ACCEPTED_REQUEST');
      });

      it('rejects conversation creation when request is pending or rejected', async () => {
        const userA = await createConfirmedUser('conv.a3@example.com');
        const userB = await createConfirmedUser('conv.b3@example.com');

        await prisma.request.create({
          data: {
            fromUserId: userA.id,
            toUserId: userB.id,
            trainNumber: '12951',
            travelDate: new Date('2026-09-15T00:00:00.000Z'),
            status: 'pending',
          },
        });

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
          });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('NO_ACCEPTED_REQUEST');
      });
    });

    describe('2. Symmetrically Blocked User Rejection', () => {
      it('rejects conversation creation with 400 USER_BLOCKED if caller blocked other user', async () => {
        const userA = await createConfirmedUser('conv.a4@example.com');
        const userB = await createConfirmedUser('conv.b4@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        await prisma.blockedUser.create({
          data: {
            blockerId: userA.id,
            blockedId: userB.id,
          },
        });

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('USER_BLOCKED');
      });

      it('rejects conversation creation with 400 USER_BLOCKED if other user blocked caller', async () => {
        const userA = await createConfirmedUser('conv.a5@example.com');
        const userB = await createConfirmedUser('conv.b5@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        await prisma.blockedUser.create({
          data: {
            blockerId: userB.id,
            blockedId: userA.id,
          },
        });

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
          });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('USER_BLOCKED');
      });
    });

    describe('3. Idempotency & Concurrency', () => {
      it('re-uses existing conversation on subsequent create calls', async () => {
        const userA = await createConfirmedUser('conv.a6@example.com');
        const userB = await createConfirmedUser('conv.b6@example.com');

        await establishAcceptedRequest(userA.id, userB.id);

        const res1 = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
            train_number: '12951',
            travel_date: '2026-09-15',
          });

        expect(res1.status).toBe(201);

        const res2 = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userB.token}`)
          .send({
            participants: [userB.id, userA.id],
            train_number: '12951',
            travel_date: '2026-09-15',
          });

        expect(res2.status).toBe(201);
        expect(res2.body.id).toBe(res1.body.id);

        const count = await prisma.conversation.count();
        expect(count).toBe(1);
      });

      it('handles concurrent conversation creation gracefully', async () => {
        const userA = await createConfirmedUser('conv.a7@example.com');
        const userB = await createConfirmedUser('conv.b7@example.com');

        await establishAcceptedRequest(userA.id, userB.id);

        const [c1, c2] = await Promise.all([
          conversationService.createConversation(userA.id, {
            participants: [userA.id, userB.id],
            trainNumber: '12951',
            travelDate: '2026-09-15',
          }),
          conversationService.createConversation(userB.id, {
            participants: [userB.id, userA.id],
            trainNumber: '12951',
            travelDate: '2026-09-15',
          }),
        ]);

        expect(c1.id).toBeDefined();
        expect(c2.id).toBeDefined();
      });
    });

    describe('4. Listing & Existence Masking', () => {
      it('lists conversations for participant ordered by last_message_time DESC', async () => {
        const userA = await createConfirmedUser('conv.a8@example.com');
        const userB = await createConfirmedUser('conv.b8@example.com');
        const userC = await createConfirmedUser('conv.c8@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        await establishAcceptedRequest(userA.id, userC.id);

        const conv1 = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
            lastMessage: 'Earlier msg',
            lastMessageTime: new Date('2026-08-24T10:00:00.000Z'),
          },
        });

        const conv2 = await prisma.conversation.create({
          data: {
            participants: [userA.id, userC.id],
            lastMessage: 'Later msg',
            lastMessageTime: new Date('2026-08-24T12:00:00.000Z'),
          },
        });

        const res = await request(app)
          .get('/conversations')
          .set('Authorization', `Bearer ${userA.token}`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].id).toBe(conv2.id); // Latest message first
        expect(res.body[1].id).toBe(conv1.id);
      });

      it('masks existence with 404 when non-participant fetches conversation by ID', async () => {
        const userA = await createConfirmedUser('conv.a9@example.com');
        const userB = await createConfirmedUser('conv.b9@example.com');
        const userC = await createConfirmedUser('conv.c9@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
          },
        });

        const res = await request(app)
          .get(`/conversations/${conv.id}`)
          .set('Authorization', `Bearer ${userC.token}`);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      });

      it('allows participant to fetch conversation by ID', async () => {
        const userA = await createConfirmedUser('conv.a10@example.com');
        const userB = await createConfirmedUser('conv.b10@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
            trainNumber: '12951',
          },
        });

        const res = await request(app)
          .get(`/conversations/${conv.id}`)
          .set('Authorization', `Bearer ${userA.token}`);

        expect(res.status).toBe(200);
        expect(res.body.id).toBe(conv.id);
        expect(res.body.trainNumber).toBe('12951');
      });
    });

    describe('5. Soft-Delete Permanence & Deleted-For Semantics', () => {
      it('soft-deletes conversation for caller, permanently hiding from listing but accessible via direct ID', async () => {
        const userA = await createConfirmedUser('conv.a11@example.com');
        const userB = await createConfirmedUser('conv.b11@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
            trainNumber: '12951',
          },
        });

        // User A soft deletes
        const delRes = await request(app)
          .delete(`/conversations/${conv.id}/for-me`)
          .set('Authorization', `Bearer ${userA.token}`);

        expect(delRes.status).toBe(204);

        // User A's list no longer includes the conversation
        const listA = await request(app)
          .get('/conversations')
          .set('Authorization', `Bearer ${userA.token}`);
        expect(listA.body).toHaveLength(0);

        // User B still sees the conversation
        const listB = await request(app)
          .get('/conversations')
          .set('Authorization', `Bearer ${userB.token}`);
        expect(listB.body).toHaveLength(1);
        expect(listB.body[0].id).toBe(conv.id);

        // Direct URL (/chat/:id) remains accessible to User A
        const directA = await request(app)
          .get(`/conversations/${conv.id}`)
          .set('Authorization', `Bearer ${userA.token}`);
        expect(directA.status).toBe(200);
        expect(directA.body.id).toBe(conv.id);
      });

      it('soft-delete is idempotent', async () => {
        const userA = await createConfirmedUser('conv.a12@example.com');
        const userB = await createConfirmedUser('conv.b12@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
          },
        });

        const del1 = await request(app)
          .delete(`/conversations/${conv.id}/for-me`)
          .set('Authorization', `Bearer ${userA.token}`);
        expect(del1.status).toBe(204);

        const del2 = await request(app)
          .delete(`/conversations/${conv.id}/for-me`)
          .set('Authorization', `Bearer ${userA.token}`);
        expect(del2.status).toBe(204);

        const dbConv = await prisma.conversation.findUnique({ where: { id: conv.id } });
        expect(dbConv?.deletedFor).toEqual([userA.id]);
      });

      it('masks existence with 404 when non-participant attempts soft-delete', async () => {
        const userA = await createConfirmedUser('conv.a13@example.com');
        const userB = await createConfirmedUser('conv.b13@example.com');
        const userC = await createConfirmedUser('conv.c13@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
          },
        });

        const res = await request(app)
          .delete(`/conversations/${conv.id}/for-me`)
          .set('Authorization', `Bearer ${userC.token}`);

        expect(res.status).toBe(404);
      });
    });

    describe('6. Immutable-Field Trigger (Database Invariant)', () => {
      it('blocks direct SQL UPDATE of protected fields (participants, train_number, travel_date, created_at, id)', async () => {
        const userA = await createConfirmedUser('conv.a14@example.com');
        const userB = await createConfirmedUser('conv.b14@example.com');
        const userC = await createConfirmedUser('conv.c14@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
            trainNumber: '12951',
            travelDate: new Date('2026-09-15T00:00:00.000Z'),
          },
        });

        // Attempting to mutate participants directly via SQL should fail via trigger
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE "conversations" SET "participants" = ARRAY['${userA.id}'::uuid, '${userC.id}'::uuid] WHERE "id" = '${conv.id}'::uuid`,
          ),
        ).rejects.toThrow(/Modifying protected conversation fields is not allowed/);

        // Attempting to mutate train_number directly via SQL should fail via trigger
        await expect(
          prisma.$executeRawUnsafe(
            `UPDATE "conversations" SET "train_number" = '99999' WHERE "id" = '${conv.id}'::uuid`,
          ),
        ).rejects.toThrow(/Modifying protected conversation fields is not allowed/);
      });

      it('allows UPDATE of last_message and last_message_time', async () => {
        const userA = await createConfirmedUser('conv.a15@example.com');
        const userB = await createConfirmedUser('conv.b15@example.com');

        await establishAcceptedRequest(userA.id, userB.id);
        const conv = await prisma.conversation.create({
          data: {
            participants: [userA.id, userB.id],
            lastMessage: 'Old msg',
          },
        });

        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessage: 'Updated msg',
            lastMessageTime: new Date('2026-08-24T15:00:00.000Z'),
          },
        });

        const updated = await prisma.conversation.findUnique({ where: { id: conv.id } });
        expect(updated?.lastMessage).toBe('Updated msg');
      });
    });

    describe('7. Strict Email Privacy Invariant', () => {
      it('never exposes email addresses in responses or participant_names', async () => {
        const userA = await createConfirmedUser('conv.a16@example.com');
        const userB = await createConfirmedUser('conv.b16@example.com');

        await establishAcceptedRequest(userA.id, userB.id);

        const res = await request(app)
          .post('/conversations')
          .set('Authorization', `Bearer ${userA.token}`)
          .send({
            participants: [userA.id, userB.id],
          });

        expect(res.status).toBe(201);
        const responseText = JSON.stringify(res.body);
        expect(responseText).not.toContain('conv.a16@example.com');
        expect(responseText).not.toContain('conv.b16@example.com');
        expect(responseText).not.toContain('email');
      });
    });
  },
);
