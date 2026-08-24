import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.ts';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import {
  getTestPrisma,
  createTestAuthService,
  createTestModerationService,
  canRunIntegration,
} from '../setup.integration.ts';
import { AuthService } from '../../src/services/auth.service.ts';
import { ModerationService } from '../../src/services/moderation.service.ts';
import { AccessService } from '../../src/services/access.service.ts';
import { ProfileService } from '../../src/services/profile.service.ts';
import { JourneyService } from '../../src/services/journey.service.ts';
import { TrainService } from '../../src/services/train.service.ts';
import {
  EmailSender,
  VerificationEmailInput,
  PasswordResetEmailInput,
} from '../../src/utils/emails.ts';

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

describe.skipIf(!canRunIntegration)('Journey lifecycle — database-backed integration tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let moderationService: ModerationService;
  let accessService: AccessService;
  let profileService: ProfileService;
  let journeyService: JourneyService;
  let trainService: TrainService;
  let app: Express;
  let emailSender: CapturingEmailSender;

  beforeEach(async () => {
    prisma = getTestPrisma();
    emailSender = new CapturingEmailSender();
    authService = await createTestAuthService(emailSender);
    moderationService = await createTestModerationService();

    const { BlockedUserRepository } = await import('../../src/repositories/blocked-users.repo.ts');
    const { ProfileRepository } = await import('../../src/repositories/profiles.repo.ts');
    const { UserRepository } = await import('../../src/repositories/users.repo.ts');
    const { JourneyRepository } = await import('../../src/repositories/journeys.repo.ts');
    const { TrainRepository } = await import('../../src/repositories/trains.repo.ts');
    const { UnverifiedTrainRepository } =
      await import('../../src/repositories/unverified-trains.repo.ts');

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

    app = createApp({
      auth: authService,
      moderation: moderationService,
      profileService,
      journeyService,
      trainService,
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

  it('1. Journey creation & persistence with verified train denormalization', async () => {
    // Seed verified train
    await prisma.train.create({
      data: { trainNumber: '12301', trainName: 'Howrah Rajdhani Express', active: true },
    });

    const user = await createConfirmedUser('traveler1@example.com');

    // Update profile name
    await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ name: 'Alex Traveler' });

    // Create journey
    const res = await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        train_number: '12301',
        travel_date: '2026-09-15',
        coach: 'B1',
        boarding_station: 'New Delhi',
        destination_station: 'Howrah',
        college: 'IIT Delhi',
        gender: 'prefer-not-to-say',
        is_train_verified: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.train_number).toBe('12301');
    expect(res.body.train_name).toBe('Howrah Rajdhani Express');
    expect(res.body.user_name).toBe('Alex Traveler');
    expect(res.body.travel_date).toBe('2026-09-15');

    // Assert no unverified train record was created
    const unverifiedCount = await prisma.unverifiedTrain.count();
    expect(unverifiedCount).toBe(0);

    // Verify in database directly
    const dbJourney = await prisma.journey.findUnique({ where: { id: res.body.id } });
    expect(dbJourney).not.toBeNull();
    expect(dbJourney?.trainNumber).toBe('12301');
    expect(dbJourney?.trainName).toBe('Howrah Rajdhani Express');
  });

  it('2. Own-journey listing and ordering by travel_date ASC', async () => {
    const user = await createConfirmedUser('traveler2@example.com');

    // Insert 2 journeys with different dates
    await request(app).post('/journeys').set('Authorization', `Bearer ${user.token}`).send({
      train_number: '12302',
      travel_date: '2026-10-01',
      train_name: 'New Delhi Rajdhani',
    });

    await request(app).post('/journeys').set('Authorization', `Bearer ${user.token}`).send({
      train_number: '12301',
      travel_date: '2026-09-10',
      train_name: 'Howrah Rajdhani',
    });

    const res = await request(app).get('/journeys/me').set('Authorization', `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].travel_date).toBe('2026-09-10');
    expect(res.body[1].travel_date).toBe('2026-10-01');
  });

  it('3. Ownership-protected deletion', async () => {
    const userA = await createConfirmedUser('owner@example.com');
    const userB = await createConfirmedUser('intruder@example.com');

    // User A creates journey
    const createRes = await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15' });
    const journeyId = createRes.body.id;

    // User B attempts to delete User A's journey -> 404 (masks existence)
    const failRes = await request(app)
      .delete(`/journeys/${journeyId}`)
      .set('Authorization', `Bearer ${userB.token}`);
    expect(failRes.status).toBe(404);

    // Assert journey still exists in db
    const stillExists = await prisma.journey.findUnique({ where: { id: journeyId } });
    expect(stillExists).not.toBeNull();

    // User A deletes own journey -> 204
    const successRes = await request(app)
      .delete(`/journeys/${journeyId}`)
      .set('Authorization', `Bearer ${userA.token}`);
    expect(successRes.status).toBe(204);

    // Assert journey is gone from db
    const deletedJourney = await prisma.journey.findUnique({ where: { id: journeyId } });
    expect(deletedJourney).toBeNull();
  });

  it('4. Exact train+date companion matching (excluding self and privacy preserved)', async () => {
    const userA = await createConfirmedUser('companionA@example.com');
    const userB = await createConfirmedUser('companionB@example.com');
    const userC = await createConfirmedUser('otherTrain@example.com');

    // User A creates journey on 12301, 2026-09-15
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15', coach: 'B1' });

    // User B creates journey on same train and date (12301, 2026-09-15)
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15', coach: 'B2' });

    // User C creates journey on different date (12301, 2026-09-20)
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userC.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-20', coach: 'B3' });

    // User A queries companions for 12301, 2026-09-15
    const res = await request(app)
      .get('/journeys/12301/2026-09-15/companions')
      .set('Authorization', `Bearer ${userA.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user_id).toBe(userB.id);
    expect(res.body[0].coach).toBe('B2');

    // STRICT EMAIL PRIVACY INVARIANT: assert email is absent
    expect(res.body[0].email).toBeUndefined();
    expect(res.body[0].user_email).toBeUndefined();
    expect(Object.keys(res.body[0])).not.toContain('email');
  });

  it('5. Symmetric blocking exclusion in companion matches', async () => {
    const userA = await createConfirmedUser('blockerA@example.com');
    const userB = await createConfirmedUser('blockedB@example.com');

    // Both on 12301, 2026-09-15
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15' });

    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${userB.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15' });

    // Initially, User A sees User B
    const initialRes = await request(app)
      .get('/journeys/12301/2026-09-15/companions')
      .set('Authorization', `Bearer ${userA.token}`);
    expect(initialRes.body).toHaveLength(1);

    // User A blocks User B
    await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${userA.token}`)
      .send({ blocked_id: userB.id });

    // User A queries companions -> User B is excluded
    const afterBlockResA = await request(app)
      .get('/journeys/12301/2026-09-15/companions')
      .set('Authorization', `Bearer ${userA.token}`);
    expect(afterBlockResA.body).toHaveLength(0);

    // User B queries companions -> User A is excluded (symmetric)
    const afterBlockResB = await request(app)
      .get('/journeys/12301/2026-09-15/companions')
      .set('Authorization', `Bearer ${userB.token}`);
    expect(afterBlockResB.body).toHaveLength(0);
  });

  it('6. Unverified train logging with normalized values', async () => {
    const user = await createConfirmedUser('unverifiedUser@example.com');

    // Create journey with unverified train
    const res = await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({
        train_number: '  99999-SPL  ',
        train_name: 'Custom Special Express',
        travel_date: '2026-09-25',
        is_train_verified: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.train_number).toBe('99999-SPL');

    // Verify unverified_trains row exists
    const unverifiedEntry = await prisma.unverifiedTrain.findFirst({
      where: { trainNumber: '99999-SPL' },
    });
    expect(unverifiedEntry).not.toBeNull();
    expect(unverifiedEntry?.submittedBy).toBe(user.id);
    expect(unverifiedEntry?.enteredValue).toBe('99999-SPL');
    expect(unverifiedEntry?.normalizedValue).toBe('99999-spl');
  });

  it('7. Train autocomplete directory search', async () => {
    const user = await createConfirmedUser('searcher@example.com');

    await prisma.train.createMany({
      data: [
        { trainNumber: '12001', trainName: 'Bhopal Shatabdi Express', active: true },
        { trainNumber: '12002', trainName: 'New Delhi Shatabdi Express', active: true },
        { trainNumber: '12951', trainName: 'Mumbai Rajdhani Express', active: true },
        { trainNumber: '99999', trainName: 'Inactive Train', active: false },
      ],
    });

    // Search by name substring
    const resName = await request(app)
      .get('/trains?q=shatabdi')
      .set('Authorization', `Bearer ${user.token}`);

    expect(resName.status).toBe(200);
    expect(resName.body).toHaveLength(2);
    expect(resName.body[0].train_number).toBe('12001');

    // Search by number prefix
    const resNum = await request(app)
      .get('/trains?q=1295')
      .set('Authorization', `Bearer ${user.token}`);

    expect(resNum.status).toBe(200);
    expect(resNum.body).toHaveLength(1);
    expect(resNum.body[0].train_name).toBe('Mumbai Rajdhani Express');

    // Inactive train excluded
    const resInactive = await request(app)
      .get('/trains?q=inactive')
      .set('Authorization', `Bearer ${user.token}`);
    expect(resInactive.body).toHaveLength(0);
  });

  it('8. Cascade deletion when user account is deleted', async () => {
    const user = await createConfirmedUser('cascadeUser@example.com');

    // Create 2 journeys
    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15' });

    await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ train_number: '12302', travel_date: '2026-09-20' });

    const countBefore = await prisma.journey.count({ where: { userId: user.id } });
    expect(countBefore).toBe(2);

    // Delete user account
    await prisma.user.delete({ where: { id: user.id } });

    // Verify journeys were cascade deleted
    const countAfter = await prisma.journey.count({ where: { userId: user.id } });
    expect(countAfter).toBe(0);
  });

  it('9. Duplicate journeys by same user on same train+date are permitted', async () => {
    const user = await createConfirmedUser('duplicateUser@example.com');

    const res1 = await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15', coach: 'B1' });
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/journeys')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ train_number: '12301', travel_date: '2026-09-15', coach: 'B2' });
    expect(res2.status).toBe(201);

    const listRes = await request(app)
      .get('/journeys/me')
      .set('Authorization', `Bearer ${user.token}`);
    expect(listRes.body).toHaveLength(2);
  });
});
