import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.ts';
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import {
  getTestPrisma,
  createTestAuthService,
  createTestModerationService,
  createTestAccessService,
  canRunIntegration,
} from '../setup.integration.ts';
import { AuthService } from '../../src/services/auth.service.ts';
import { ModerationService } from '../../src/services/moderation.service.ts';
import { AccessService } from '../../src/services/access.service.ts';
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

describe.skipIf(!canRunIntegration)(
  'Moderation lifecycle — database-backed integration tests',
  () => {
    let prisma: PrismaClient;
    let authService: AuthService;
    let moderationService: ModerationService;
    let accessService: AccessService;
    let app: Express;
    let emailSender: CapturingEmailSender;

    beforeEach(async () => {
      prisma = getTestPrisma();
      emailSender = new CapturingEmailSender();
      authService = await createTestAuthService(emailSender);
      moderationService = await createTestModerationService();
      accessService = await createTestAccessService();
      app = createApp({ auth: authService, moderation: moderationService });
    });

    async function registerAndLogin(
      email: string,
      password = 'password123',
    ): Promise<{ userId: string; accessToken: string }> {
      await request(app).post('/auth/register').send({ email, password });
      const rawToken = emailSender.lastVerificationToken!;
      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app).post('/auth/login').send({ email, password });
      expect(loginRes.status).toBe(200);

      return {
        userId: loginRes.body.user.id,
        accessToken: loginRes.body.access_token,
      };
    }

    describe('Blocking lifecycle and symmetric access checks', () => {
      it('block → verify DB → verify symmetric isBlocked → list → unblock → verify deleted', async () => {
        // 1. Create two real confirmed users
        const user1 = await registerAndLogin('blocker@example.com');
        const user2 = await registerAndLogin('blocked@example.com');

        // 2. Initially, neither user is blocked
        expect(await accessService.isBlocked(user1.userId, user2.userId)).toBe(false);
        expect(await accessService.isBlocked(user2.userId, user1.userId)).toBe(false);

        // 3. User 1 blocks User 2 via HTTP POST /blocked-users
        const blockRes = await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: user2.userId });

        expect(blockRes.status).toBe(200);
        expect(blockRes.body).toMatchObject({
          id: expect.any(String),
          blockerId: user1.userId,
          blockedId: user2.userId,
        });

        // 4. Verify in the real PostgreSQL database that a row exists
        const dbBlock = await prisma.blockedUser.findUnique({
          where: {
            blockerId_blockedId: {
              blockerId: user1.userId,
              blockedId: user2.userId,
            },
          },
        });
        expect(dbBlock).not.toBeNull();
        expect(dbBlock!.blockerId).toBe(user1.userId);
        expect(dbBlock!.blockedId).toBe(user2.userId);

        // 5. Verify AccessService isBlocked is strictly SYMMETRIC in real DB
        expect(await accessService.isBlocked(user1.userId, user2.userId)).toBe(true);
        expect(await accessService.isBlocked(user2.userId, user1.userId)).toBe(true);

        const u1Symmetric = await accessService.getSymmetricBlockedUserIds(user1.userId);
        expect(u1Symmetric.has(user2.userId)).toBe(true);

        const u2Symmetric = await accessService.getSymmetricBlockedUserIds(user2.userId);
        expect(u2Symmetric.has(user1.userId)).toBe(true);

        // 6. User 1 lists blocked users: sees User 2
        const listRes1 = await request(app)
          .get('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`);

        expect(listRes1.status).toBe(200);
        expect(listRes1.body).toEqual([{ blocked_id: user2.userId }]);

        // 7. User 2 lists blocked users: receives empty array (cannot see who blocked them)
        const listRes2 = await request(app)
          .get('/blocked-users')
          .set('Authorization', `Bearer ${user2.accessToken}`);

        expect(listRes2.status).toBe(200);
        expect(listRes2.body).toEqual([]);

        // 8. Re-blocking is idempotent (200, no duplicate row in DB)
        const reBlockRes = await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: user2.userId });

        expect(reBlockRes.status).toBe(200);
        const totalBlocks = await prisma.blockedUser.count({
          where: { blockerId: user1.userId, blockedId: user2.userId },
        });
        expect(totalBlocks).toBe(1);

        // 9. User 1 unblocks User 2 via HTTP DELETE /blocked-users/:blockedId
        const unblockRes = await request(app)
          .delete(`/blocked-users/${user2.userId}`)
          .set('Authorization', `Bearer ${user1.accessToken}`);

        expect(unblockRes.status).toBe(204);

        // 10. Verify row is deleted from the real database
        const dbBlockAfter = await prisma.blockedUser.findUnique({
          where: {
            blockerId_blockedId: {
              blockerId: user1.userId,
              blockedId: user2.userId,
            },
          },
        });
        expect(dbBlockAfter).toBeNull();

        // 11. Verify isBlocked is now false in both directions
        expect(await accessService.isBlocked(user1.userId, user2.userId)).toBe(false);
        expect(await accessService.isBlocked(user2.userId, user1.userId)).toBe(false);

        // 12. Deleting non-existent block is idempotent (204)
        const unblockAgainRes = await request(app)
          .delete(`/blocked-users/${user2.userId}`)
          .set('Authorization', `Bearer ${user1.accessToken}`);

        expect(unblockAgainRes.status).toBe(204);
      });

      it('directional unblocking preserves the other party’s block row and keeps isBlocked true', async () => {
        const user1 = await registerAndLogin('mutual1@example.com');
        const user2 = await registerAndLogin('mutual2@example.com');

        // Both users block each other
        await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: user2.userId });

        await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user2.accessToken}`)
          .send({ blocked_id: user1.userId });

        // Two distinct directional rows exist
        const allRows = await prisma.blockedUser.findMany({
          where: {
            OR: [
              { blockerId: user1.userId, blockedId: user2.userId },
              { blockerId: user2.userId, blockedId: user1.userId },
            ],
          },
        });
        expect(allRows).toHaveLength(2);

        // User 1 unblocks User 2
        await request(app)
          .delete(`/blocked-users/${user2.userId}`)
          .set('Authorization', `Bearer ${user1.accessToken}`);

        // Only User 1's row was deleted; User 2's block of User 1 remains
        const u1Row = await prisma.blockedUser.findUnique({
          where: { blockerId_blockedId: { blockerId: user1.userId, blockedId: user2.userId } },
        });
        expect(u1Row).toBeNull();

        const u2Row = await prisma.blockedUser.findUnique({
          where: { blockerId_blockedId: { blockerId: user2.userId, blockedId: user1.userId } },
        });
        expect(u2Row).not.toBeNull();

        // isBlocked remains true because User 2 still blocks User 1
        expect(await accessService.isBlocked(user1.userId, user2.userId)).toBe(true);
        expect(await accessService.isBlocked(user2.userId, user1.userId)).toBe(true);

        // User 2 unblocks User 1
        await request(app)
          .delete(`/blocked-users/${user1.userId}`)
          .set('Authorization', `Bearer ${user2.accessToken}`);

        expect(await accessService.isBlocked(user1.userId, user2.userId)).toBe(false);
      });

      it('rejects self-block attempts with 400 VALIDATION_ERROR and writes nothing to DB', async () => {
        const user1 = await registerAndLogin('selfblock@example.com');

        const res = await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: user1.userId });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');

        const totalBlocks = await prisma.blockedUser.count({
          where: { blockerId: user1.userId },
        });
        expect(totalBlocks).toBe(0);
      });

      it('rejects blocking a non-existent user with 404 USER_NOT_FOUND', async () => {
        const user1 = await registerAndLogin('blockghost@example.com');
        const ghostId = '00000000-0000-4000-8000-999999999999';

        const res = await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: ghostId });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });
    });

    describe('User reporting lifecycle', () => {
      it('creates and persists report in database with trimmed reason and handles duplicate reports', async () => {
        const reporter = await registerAndLogin('reporter@example.com');
        const reported = await registerAndLogin('reported@example.com');

        // 1. Submit first report with leading/trailing whitespace
        const report1Res = await request(app)
          .post('/reports')
          .set('Authorization', `Bearer ${reporter.accessToken}`)
          .send({
            reported_id: reported.userId,
            reason: '   Inappropriate behavior on train   ',
          });

        expect(report1Res.status).toBe(201);
        expect(report1Res.body).toMatchObject({
          id: expect.any(String),
          reporterId: reporter.userId,
          reportedId: reported.userId,
          reason: 'Inappropriate behavior on train',
        });

        // 2. Verify row in PostgreSQL database
        const dbReport1 = await prisma.userReport.findUnique({
          where: { id: report1Res.body.id },
        });
        expect(dbReport1).not.toBeNull();
        expect(dbReport1!.reason).toBe('Inappropriate behavior on train');

        // 3. Submit second report with empty reason -> normalized to null
        const report2Res = await request(app)
          .post('/reports')
          .set('Authorization', `Bearer ${reporter.accessToken}`)
          .send({
            reported_id: reported.userId,
            reason: '    ',
          });

        expect(report2Res.status).toBe(201);
        expect(report2Res.body.reason).toBeNull();

        const dbReport2 = await prisma.userReport.findUnique({
          where: { id: report2Res.body.id },
        });
        expect(dbReport2!.reason).toBeNull();

        // 4. Verify 2 separate reports exist in DB
        const totalReports = await prisma.userReport.count({
          where: { reporterId: reporter.userId, reportedId: reported.userId },
        });
        expect(totalReports).toBe(2);
      });

      it('rejects self-report with 400 VALIDATION_ERROR', async () => {
        const user1 = await registerAndLogin('selfreport@example.com');

        const res = await request(app)
          .post('/reports')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ reported_id: user1.userId, reason: 'Self reporting' });

        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');

        const totalReports = await prisma.userReport.count({
          where: { reporterId: user1.userId },
        });
        expect(totalReports).toBe(0);
      });

      it('rejects reporting a non-existent user with 404 USER_NOT_FOUND', async () => {
        const user1 = await registerAndLogin('reportghost@example.com');
        const ghostId = '00000000-0000-4000-8000-999999999999';

        const res = await request(app)
          .post('/reports')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ reported_id: ghostId, reason: 'Ghost report' });

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('USER_NOT_FOUND');
      });
    });

    describe('Database integrity and cascade deletion', () => {
      it('deleting a user cascades and deletes all related block and report records', async () => {
        const user1 = await registerAndLogin('cascade_u1@example.com');
        const user2 = await registerAndLogin('cascade_u2@example.com');

        // User 1 blocks User 2 and User 1 reports User 2
        await request(app)
          .post('/blocked-users')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ blocked_id: user2.userId });

        await request(app)
          .post('/reports')
          .set('Authorization', `Bearer ${user1.accessToken}`)
          .send({ reported_id: user2.userId, reason: 'To be cascaded' });

        // Verify records exist
        expect(
          await prisma.blockedUser.count({
            where: { blockerId: user1.userId, blockedId: user2.userId },
          }),
        ).toBe(1);

        expect(
          await prisma.userReport.count({
            where: { reporterId: user1.userId, reportedId: user2.userId },
          }),
        ).toBe(1);

        // Delete User 2 directly via Prisma
        await prisma.user.delete({ where: { id: user2.userId } });

        // Verify blocks and reports referencing User 2 were cascade-deleted by PostgreSQL
        expect(
          await prisma.blockedUser.count({
            where: { OR: [{ blockerId: user2.userId }, { blockedId: user2.userId }] },
          }),
        ).toBe(0);

        expect(
          await prisma.userReport.count({
            where: { OR: [{ reporterId: user2.userId }, { reportedId: user2.userId }] },
          }),
        ).toBe(0);
      });
    });
  },
);
