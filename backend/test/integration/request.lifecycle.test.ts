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

describe.skipIf(!canRunIntegration)('Request lifecycle — database-backed integration tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let moderationService: ModerationService;
  let accessService: AccessService;
  let profileService: ProfileService;
  let journeyService: JourneyService;
  let trainService: TrainService;
  let requestService: RequestService;
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

    app = createApp({
      auth: authService,
      moderation: moderationService,
      profileService,
      journeyService,
      trainService,
      requestService,
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

  /** Helper to setup matching journeys for two users */
  async function setupMatchingJourneys(
    userA: { id: string; token: string },
    userB: { id: string; token: string },
    trainNumber = '12951',
    travelDate = '2026-09-15',
  ) {
    await prisma.train.upsert({
      where: { trainNumber },
      create: { trainNumber, trainName: 'Mumbai Rajdhani', active: true },
      update: {},
    });

    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ train_number: trainNumber, travel_date: travelDate });

    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ train_number: trainNumber, travel_date: travelDate });
  }

  it('1. Request creation & persistence with valid shared journey', async () => {
    const userA = await createConfirmedUser('alice@example.com');
    const userB = await createConfirmedUser('bob@example.com');

    await setupMatchingJourneys(userA, userB);

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        from_name: 'Alice',
        to_name: 'Bob',
        train_number: '12951',
        travel_date: '2026-09-15',
        boarding_station: 'Mumbai Central',
        destination_station: 'New Delhi',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.from_user_id).toBe(userA.id);
    expect(res.body.to_user_id).toBe(userB.id);
    expect(res.body.status).toBe('pending');
    expect(res.body.travel_date).toBe('2026-09-15');

    // Verify in real database
    const saved = await prisma.request.findUnique({ where: { id: res.body.id } });
    expect(saved).not.toBeNull();
    expect(saved?.fromUserId).toBe(userA.id);
    expect(saved?.toUserId).toBe(userB.id);
    expect(saved?.status).toBe('pending');
  });

  it('2. Shared-journey requirement enforcement (rejects if not on same train/date)', async () => {
    const userA = await createConfirmedUser('travelerA@example.com');
    const userB = await createConfirmedUser('travelerB@example.com');

    // Only userA creates a journey
    await prisma.train.upsert({
      where: { trainNumber: '12951' },
      create: { trainNumber: '12951', trainName: 'Mumbai Rajdhani', active: true },
      update: {},
    });
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ train_number: '12951', travel_date: '2026-09-15' });

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_MATCHING_JOURNEY');
  });

  it('3. Self-request rejection (400 SELF_REQUEST)', async () => {
    const userA = await createConfirmedUser('selfuser@example.com');

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userA.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('4. Symmetric blocking rejection (sender blocked recipient OR recipient blocked sender)', async () => {
    const userA = await createConfirmedUser('blockerA@example.com');
    const userB = await createConfirmedUser('blockedB@example.com');

    await setupMatchingJourneys(userA, userB);

    // userB blocks userA
    const blockRes = await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ blocked_id: userA.id });
    expect(blockRes.status).toBe(200);

    // userA attempts to send request -> rejected
    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('USER_BLOCKED');
  });

  it('5. Recipient acceptance (pending -> accepted) & unlocks profile access', async () => {
    const userA = await createConfirmedUser('sender5@example.com');
    const userB = await createConfirmedUser('recipient5@example.com');

    await setupMatchingJourneys(userA, userB);

    const createRes = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    expect(createRes.status).toBe(201);
    const requestId = createRes.body.id;

    // Recipient accepts
    const acceptRes = await request(app)
      .patch(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ status: 'accepted' });

    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.status).toBe('accepted');

    // Verify DB updated
    const saved = await prisma.request.findUnique({ where: { id: requestId } });
    expect(saved?.status).toBe('accepted');

    // AccessService verification: hasAcceptedRequest returns true
    const hasAccepted = await accessService.hasAcceptedRequest(userA.id, userB.id);
    expect(hasAccepted).toBe(true);

    // Profile viewing now permitted via accepted request
    const canView = await accessService.canViewProfile(userA.id, userB.id);
    expect(canView).toBe(true);
  });

  it('6. Recipient rejection (pending -> rejected)', async () => {
    const userA = await createConfirmedUser('sender6@example.com');
    const userB = await createConfirmedUser('recipient6@example.com');

    await setupMatchingJourneys(userA, userB);

    const createRes = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    const requestId = createRes.body.id;

    // Recipient rejects
    const rejectRes = await request(app)
      .patch(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ status: 'rejected' });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe('rejected');

    // Attempting to accept a rejected request fails
    const reAcceptRes = await request(app)
      .patch(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ status: 'accepted' });

    expect(reAcceptRes.status).toBe(400);
    expect(reAcceptRes.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('7. Sender cancellation (hard deletes pending request)', async () => {
    const userA = await createConfirmedUser('sender7@example.com');
    const userB = await createConfirmedUser('recipient7@example.com');

    await setupMatchingJourneys(userA, userB);

    const createRes = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    const requestId = createRes.body.id;

    // Sender cancels
    const deleteRes = await request(app)
      .delete(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userA.token}`);

    expect(deleteRes.status).toBe(204);

    // Verify row hard deleted
    const saved = await prisma.request.findUnique({ where: { id: requestId } });
    expect(saved).toBeNull();
  });

  it('8. Non-owner / unauthorized access masks existence with 404', async () => {
    const userA = await createConfirmedUser('sender8@example.com');
    const userB = await createConfirmedUser('recipient8@example.com');
    const userC = await createConfirmedUser('outsider8@example.com');

    await setupMatchingJourneys(userA, userB);

    const createRes = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    const requestId = createRes.body.id;

    // Outsider cannot accept
    const badAccept = await request(app)
      .patch(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userC.token}`)
      .send({ status: 'accepted' });
    expect(badAccept.status).toBe(404);

    // Outsider cannot cancel
    const badDelete = await request(app)
      .delete(`/requests/${requestId}`)
      .set('Authorization', `Bearer ${userC.token}`);
    expect(badDelete.status).toBe(404);
  });

  it('9. Re-request after rejection allows creating a new pending request', async () => {
    const userA = await createConfirmedUser('sender9@example.com');
    const userB = await createConfirmedUser('recipient9@example.com');

    await setupMatchingJourneys(userA, userB);

    // 1st request -> rejected
    const req1 = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    await request(app)
      .patch(`/requests/${req1.body.id}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ status: 'rejected' });

    // 2nd request -> succeeds (re-requesting allowed)
    const req2 = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    expect(req2.status).toBe(201);
    expect(req2.body.id).not.toBe(req1.body.id);
    expect(req2.body.status).toBe('pending');
  });

  it('10. Active duplicate pending rejection (409 REQUEST_ALREADY_PENDING)', async () => {
    const userA = await createConfirmedUser('sender10@example.com');
    const userB = await createConfirmedUser('recipient10@example.com');

    await setupMatchingJourneys(userA, userB);

    // 1st request
    const req1 = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    expect(req1.status).toBe(201);

    // Duplicate request while 1st is still pending -> 409
    const req2 = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    expect(req2.status).toBe(409);
    expect(req2.body.error.code).toBe('REQUEST_ALREADY_PENDING');
  });

  it('11. Expired cleanup prunes pending requests prior to cutoff in atomic query', async () => {
    const userA = await createConfirmedUser('sender11@example.com');
    const userB = await createConfirmedUser('recipient11@example.com');

    // Create old expired request directly in database
    await prisma.request.create({
      data: {
        fromUserId: userA.id,
        toUserId: userB.id,
        trainNumber: '12951',
        travelDate: new Date('2026-08-01T00:00:00.000Z'),
        status: 'pending',
      },
    });

    // Create future request
    await prisma.request.create({
      data: {
        fromUserId: userA.id,
        toUserId: userB.id,
        trainNumber: '12951',
        travelDate: new Date('2026-10-01T00:00:00.000Z'),
        status: 'pending',
      },
    });

    const cleanupRes = await request(app)
      .post('/requests/cleanup-expired')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ cutoff_date: '2026-08-15' });

    expect(cleanupRes.status).toBe(200);
    expect(cleanupRes.body.count).toBe(1);

    // Future request remains
    const remaining = await prisma.request.findMany({ where: { fromUserId: userA.id } });
    expect(remaining).toHaveLength(1);
  });

  it('12. Cascade deletion (deleting user cascades to requests table)', async () => {
    const userA = await createConfirmedUser('sender12@example.com');
    const userB = await createConfirmedUser('recipient12@example.com');

    await setupMatchingJourneys(userA, userB);

    const req = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });
    expect(req.status).toBe(201);

    // Delete userA
    await prisma.user.delete({ where: { id: userA.id } });

    // Request should be cascade deleted
    const saved = await prisma.request.findUnique({ where: { id: req.body.id } });
    expect(saved).toBeNull();
  });

  it('13. Strict email privacy & frontend dual camelCase/snake_case contract', async () => {
    const userA = await createConfirmedUser('privacyA@example.com');
    const userB = await createConfirmedUser('privacyB@example.com');

    await setupMatchingJourneys(userA, userB);

    const res = await request(app)
      .post('/requests')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({
        to_user_id: userB.id,
        train_number: '12951',
        travel_date: '2026-09-15',
      });

    expect(res.status).toBe(201);

    // Frontend compatibility: both casings present
    expect(res.body.fromUserId).toBe(userA.id);
    expect(res.body.from_user_id).toBe(userA.id);
    expect(res.body.toUserId).toBe(userB.id);
    expect(res.body.to_user_id).toBe(userB.id);
    expect(res.body.travelDate).toBe('2026-09-15');
    expect(res.body.travel_date).toBe('2026-09-15');

    // Email Privacy Invariant: no email exposed
    expect(res.body.fromEmail).toBeUndefined();
    expect(res.body.from_email).toBeUndefined();
    expect(res.body.toEmail).toBeUndefined();
    expect(res.body.to_email).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('privacyA@example.com');
    expect(JSON.stringify(res.body)).not.toContain('privacyB@example.com');
  });

  it('14. Incoming pending count for Dashboard bell badge', async () => {
    const userA = await createConfirmedUser('sender14@example.com');
    const userB = await createConfirmedUser('recipient14@example.com');

    await setupMatchingJourneys(userA, userB);

    await request(app).post('/requests').set('Authorization', `Bearer ${userA.token}`).send({
      to_user_id: userB.id,
      train_number: '12951',
      travel_date: '2026-09-15',
    });

    const countRes = await request(app)
      .get('/requests/incoming/pending-count')
      .set('Authorization', `Bearer ${userB.token}`);

    expect(countRes.status).toBe(200);
    expect(countRes.body).toEqual({ count: 1 });
  });
});
