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
import {
  AccessService,
  type ContextualRelationshipChecker,
} from '../../src/services/access.service.ts';
import { ProfileService } from '../../src/services/profile.service.ts';
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

describe.skipIf(!canRunIntegration)('Profile lifecycle — database-backed integration tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let moderationService: ModerationService;
  let accessService: AccessService;
  let profileService: ProfileService;
  let app: Express;
  let emailSender: CapturingEmailSender;
  let contextualChecker: ContextualRelationshipChecker;

  beforeEach(async () => {
    prisma = getTestPrisma();
    emailSender = new CapturingEmailSender();
    authService = await createTestAuthService(emailSender);
    moderationService = await createTestModerationService();

    contextualChecker = {
      hasSharedJourney: async () => false,
      hasAcceptedRequest: async () => false,
      hasSharedConversation: async () => false,
    };

    const { BlockedUserRepository } = await import('../../src/repositories/blocked-users.repo.ts');
    const { ProfileRepository } = await import('../../src/repositories/profiles.repo.ts');
    const { UserRepository } = await import('../../src/repositories/users.repo.ts');

    accessService = new AccessService({
      blockedUsers: new BlockedUserRepository(prisma),
      db: prisma,
      contextual: contextualChecker,
    });

    profileService = new ProfileService({
      profiles: new ProfileRepository(prisma),
      users: new UserRepository(prisma),
      access: accessService,
    });

    app = createApp({
      auth: authService,
      moderation: moderationService,
      profileService,
    });
  });

  async function registerAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ userId: string; accessToken: string }> {
    await request(app).post('/auth/register').send({ email, password });
    const rawToken = emailSender.lastVerificationToken!;
    await request(app).post('/auth/confirm-email').send({ token: rawToken });

    const loginRes = await request(app).post('/auth/login').send({ email, password });

    return {
      userId: loginRes.body.user.id,
      accessToken: loginRes.body.access_token,
    };
  }

  it('1. Registration auto-creates a profile row in the database', async () => {
    const { userId } = await registerAndLogin('auto-profile@example.com');

    const profileRow = await prisma.profile.findUnique({
      where: { id: userId },
    });

    expect(profileRow).not.toBeNull();
    expect(profileRow?.id).toBe(userId);
    expect(profileRow?.name).toBeNull();
  });

  it('2. GET /profiles/me returns authenticated user full profile with email', async () => {
    const email = 'alice-own@example.com';
    const { userId, accessToken } = await registerAndLogin(email);

    const res = await request(app)
      .get('/profiles/me')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: userId,
      email,
      name: null,
      bio: null,
      hobbies: null,
      college: null,
      gender: null,
      avatar_url: null,
    });
    expect(res.body.email).toBe(email);
  });

  it('3. PATCH /profiles/me updates allowed fields and normalizes gender', async () => {
    const email = 'bob-patch@example.com';
    const { userId, accessToken } = await registerAndLogin(email);

    const updateRes = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: '  Bob Smith  ',
        bio: '  Frequent traveler  ',
        hobbies: '  Music, Hiking  ',
        college: '  IIT Madras  ',
        gender: 'prefer-not-to-say',
        avatar_url: '  https://storage.trainmate.local/avatars/bob.jpg  ',
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body).toMatchObject({
      id: userId,
      email,
      name: 'Bob Smith',
      bio: 'Frequent traveler',
      hobbies: 'Music, Hiking',
      college: 'IIT Madras',
      gender: 'prefer_not_to_say',
      avatar_url: 'https://storage.trainmate.local/avatars/bob.jpg',
    });

    // Verify persisted in PostgreSQL
    const dbProfile = await prisma.profile.findUnique({ where: { id: userId } });
    expect(dbProfile?.name).toBe('Bob Smith');
    expect(dbProfile?.gender).toBe('prefer_not_to_say');
  });

  it('4. Strangers cannot view profile (returns 404 USER_NOT_FOUND to resist existence probing)', async () => {
    const userA = await registerAndLogin('user-a@example.com');
    const userB = await registerAndLogin('user-b@example.com');

    const res = await request(app)
      .get(`/profiles/${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('5. Contextual visibility allows public profile view and STRICTLY OMITS EMAIL', async () => {
    const userA = await registerAndLogin('user-a2@example.com');
    const userB = await registerAndLogin('user-b2@example.com');

    // Set userB profile details
    await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({
        name: 'User B',
        bio: 'B Bio',
        college: 'BITS Pilani',
        gender: 'male',
      });

    // Grant contextual relationship (e.g. shared train journey)
    contextualChecker.hasSharedJourney = async (a, b) =>
      (a === userA.userId && b === userB.userId) || (a === userB.userId && b === userA.userId);

    const res = await request(app)
      .get(`/profiles/${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: userB.userId,
      name: 'User B',
      bio: 'B Bio',
      college: 'BITS Pilani',
      gender: 'male',
    });

    // CRITICAL EMAIL PRIVACY INVARIANT CHECK
    expect('email' in res.body).toBe(false);
    expect(Object.keys(res.body)).not.toContain('email');
    expect((res.body as Record<string, unknown>).email).toBeUndefined();
  });

  it('6. Symmetric blocking prevents profile view in both directions (returns 404)', async () => {
    const userA = await registerAndLogin('user-block-a@example.com');
    const userB = await registerAndLogin('user-block-b@example.com');

    // Contextual relationship exists
    contextualChecker.hasAcceptedRequest = async (a, b) =>
      (a === userA.userId && b === userB.userId) || (a === userB.userId && b === userA.userId);

    // User A blocks User B
    await request(app)
      .post('/blocked-users')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ blocked_id: userB.userId });

    // User A cannot view User B
    const resA = await request(app)
      .get(`/profiles/${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(resA.status).toBe(404);

    // User B cannot view User A (symmetric!)
    const resB = await request(app)
      .get(`/profiles/${userA.userId}`)
      .set('Authorization', `Bearer ${userB.accessToken}`);
    expect(resB.status).toBe(404);

    // User A unblocks User B -> profile view restored
    await request(app)
      .delete(`/blocked-users/${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);

    const resRestored = await request(app)
      .get(`/profiles/${userB.userId}`)
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(resRestored.status).toBe(200);
    expect('email' in resRestored.body).toBe(false);
  });

  it('7. GET /profiles/:userId/name returns display name when contextual, { name: null } when unviewable', async () => {
    const userA = await registerAndLogin('name-a@example.com');
    const userB = await registerAndLogin('name-b@example.com');

    await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({ name: 'Sam Taylor' });

    // Stranger -> name is null
    const strangerRes = await request(app)
      .get(`/profiles/${userB.userId}/name`)
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(strangerRes.status).toBe(200);
    expect(strangerRes.body).toEqual({ name: null });

    // Contextual conversation exists -> name is returned
    contextualChecker.hasSharedConversation = async (a, b) =>
      (a === userA.userId && b === userB.userId) || (a === userB.userId && b === userA.userId);

    const contextualRes = await request(app)
      .get(`/profiles/${userB.userId}/name`)
      .set('Authorization', `Bearer ${userA.accessToken}`);
    expect(contextualRes.status).toBe(200);
    expect(contextualRes.body).toEqual({ name: 'Sam Taylor' });
    expect('email' in contextualRes.body).toBe(false);
  });

  it('8. Deleting a user cascade-deletes their profile record', async () => {
    const { userId } = await registerAndLogin('cascade@example.com');

    const profileBefore = await prisma.profile.findUnique({ where: { id: userId } });
    expect(profileBefore).not.toBeNull();

    // Delete user
    await prisma.user.delete({ where: { id: userId } });

    const profileAfter = await prisma.profile.findUnique({ where: { id: userId } });
    expect(profileAfter).toBeNull();
  });

  it('9. Validation errors reject invalid input without modifying database', async () => {
    const { userId, accessToken } = await registerAndLogin('validation@example.com');

    const longNameRes = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'a'.repeat(101) });

    expect(longNameRes.status).toBe(400);
    expect(longNameRes.body.error.code).toBe('VALIDATION_ERROR');

    const invalidGenderRes = await request(app)
      .patch('/profiles/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ gender: 'unknown' });

    expect(invalidGenderRes.status).toBe(400);
    expect(invalidGenderRes.body.error.code).toBe('VALIDATION_ERROR');

    // Profile remains untouched
    const dbProfile = await prisma.profile.findUnique({ where: { id: userId } });
    expect(dbProfile?.name).toBeNull();
  });
});
