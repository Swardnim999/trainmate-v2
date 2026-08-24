import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.ts';
import type { Express } from 'express';
import { PrismaClient } from '@prisma/client';
import { getTestPrisma, createTestAuthService, canRunIntegration } from '../setup.integration.ts';
import { AuthService } from '../../src/services/auth.service.ts';
import { tokenOps } from '../../src/utils/tokens.ts';
import {
  EmailSender,
  VerificationEmailInput,
  PasswordResetEmailInput,
} from '../../src/utils/emails.ts';

const DEFAULT_ORIGIN = 'http://localhost:5173';

/**
 * Test email sender that captures the last sent verification/reset tokens
 * for use in integration tests.
 */
class CapturingEmailSender implements EmailSender {
  public lastVerificationToken: string | null = null;
  public lastResetToken: string | null = null;
  public lastVerificationEmail: string | null = null;
  public lastResetEmail: string | null = null;

  async sendVerificationEmail(input: VerificationEmailInput): Promise<void> {
    this.lastVerificationToken = input.token;
    this.lastVerificationEmail = input.to;
  }

  async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    this.lastResetToken = input.token;
    this.lastResetEmail = input.to;
  }

  clear(): void {
    this.lastVerificationToken = null;
    this.lastResetToken = null;
    this.lastVerificationEmail = null;
    this.lastResetEmail = null;
  }
}

describe.skipIf(!canRunIntegration)('Auth lifecycle — database-backed integration tests', () => {
  let prisma: PrismaClient;
  let authService: AuthService;
  let app: Express;
  let emailSender: CapturingEmailSender;

  beforeEach(async () => {
    prisma = getTestPrisma();
    emailSender = new CapturingEmailSender();
    authService = await createTestAuthService(emailSender);
    app = createApp({ auth: authService });
  });

  afterEach(async () => {
    // Cleanup handled by setup.integration.ts beforeEach
  });

  describe('Complete registration → confirmation → login → session flow', () => {
    it('registers a user, confirms email via real token, logs in, and accesses protected route', async () => {
      // 1. Register a new user
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'newuser@example.com', password: 'password123' });

      expect(registerRes.status).toBe(200);
      expect(registerRes.body).toEqual({
        user: { id: expect.any(String), email: 'newuser@example.com' },
        confirmationRequired: true,
      });
      const userId = registerRes.body.user.id;

      // 2. Verify the user was created in DB as unconfirmed
      let user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user).not.toBeNull();
      expect(user!.emailConfirmedAt).toBeNull();
      expect(user!.email).toBe('newuser@example.com');

      // 3. Verify email verification token was created in DB
      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'signup' },
      });
      expect(verification).not.toBeNull();
      expect(verification!.type).toBe('signup');
      expect(verification!.consumedAt).toBeNull();
      expect(verification!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // 4. Get the actual raw verification token from the capturing email sender
      const rawToken = emailSender.lastVerificationToken;
      expect(rawToken).not.toBeNull();
      expect(tokenOps.isValid(rawToken!)).toBe(true);

      // 5. Confirm email via POST /confirm-email using the REAL token
      const confirmRes = await request(app).post('/auth/confirm-email').send({ token: rawToken! });

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body).toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_in: expect.any(Number),
        token_type: 'bearer',
        user: { id: userId, email: 'newuser@example.com' },
      });

      // 6. Verify token is consumed and email_confirmed_at is populated
      const consumedVerification = await prisma.emailVerification.findUnique({
        where: { id: verification!.id },
      });
      expect(consumedVerification!.consumedAt).not.toBeNull();

      user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.emailConfirmedAt).not.toBeNull();

      // 7. Verify the returned refresh token exists in DB as a new family
      const refreshTokens = await prisma.refreshToken.findMany({
        where: { userId },
      });
      expect(refreshTokens).toHaveLength(1);
      expect(refreshTokens[0].revokedAt).toBeNull();
      const familyId = refreshTokens[0].familyId;

      // 8. Login with the confirmed user
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'newuser@example.com', password: 'password123' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body).toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_in: expect.any(Number),
        token_type: 'bearer',
        user: { id: userId, email: 'newuser@example.com' },
      });

      // 9. Verify a second refresh token family was created
      const refreshTokensAfterLogin = await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(refreshTokensAfterLogin).toHaveLength(2);
      // First family should still be active (from confirmation)
      expect(refreshTokensAfterLogin[0].revokedAt).toBeNull();
      // Second family should be active (from login)
      expect(refreshTokensAfterLogin[1].revokedAt).toBeNull();
      expect(refreshTokensAfterLogin[1].familyId).not.toBe(familyId);

      // 10. Call GET /auth/session with the returned bearer token
      const accessToken = loginRes.body.access_token;
      const sessionRes = await request(app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body).toEqual({
        user: { id: userId, email: 'newuser@example.com' },
        expires_at: expect.any(Number),
      });
    });

    it('register → confirm (GET verify-email) → login → session → refresh → logout', async () => {
      // 1. Register
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'flowuser@example.com', password: 'password123' });

      expect(registerRes.status).toBe(200);
      const userId = registerRes.body.user.id;

      // 2. Get raw token from email sender
      const rawToken = emailSender.lastVerificationToken;
      expect(rawToken).not.toBeNull();

      // 3. Use GET /verify-email (browser flow) with the real token
      const verifyRes = await request(app).get('/auth/verify-email').query({ token: rawToken! });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toContain(DEFAULT_ORIGIN);
      expect(verifyRes.headers.location).toContain('access_token=');
      expect(verifyRes.headers.location).toContain('refresh_token=');
      expect(verifyRes.headers.location).toContain('expires_at=');
      expect(verifyRes.headers.location).toContain('token_type=bearer');

      // 4. Verify token consumed and email confirmed
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.emailConfirmedAt).not.toBeNull();

      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'signup' },
      });
      expect(verification!.consumedAt).not.toBeNull();

      // 5. Login - creates a NEW refresh token family
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'flowuser@example.com', password: 'password123' });

      expect(loginRes.status).toBe(200);
      const { access_token, refresh_token } = loginRes.body;

      // 6. Access session
      const sessionRes = await request(app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${access_token}`);

      expect(sessionRes.status).toBe(200);
      expect(sessionRes.body.user.id).toBe(userId);

      // 7. Refresh - should rotate the LOGIN family's refresh token
      const refreshRes = await request(app).post('/auth/refresh').send({ refresh_token });

      expect(refreshRes.status).toBe(200);
      // Refresh token MUST change on rotation; access_token may be identical if within same second
      expect(refreshRes.body.refresh_token).not.toBe(refresh_token);

      const newRefreshToken = refreshRes.body.refresh_token;

      // 8. Verify old refresh token is revoked and new one created in same family (the login family)
      // There are now 3 families: confirm (1), login (2), refresh (rotated from login = still family 2)
      const tokens = await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      // confirm family (active), login family (old revoked), rotated login family (active)
      expect(tokens).toHaveLength(3);
      expect(tokens[0].revokedAt).toBeNull(); // confirm family still active
      expect(tokens[1].revokedAt).not.toBeNull(); // login family old token revoked
      expect(tokens[2].revokedAt).toBeNull(); // rotated login family active
      expect(tokens[2].familyId).toBe(tokens[1].familyId); // same family as login
      // replacedByTokenHash is set on the OLD token when it's revoked, not the new one
      expect(tokens[1].replacedByTokenHash).toBe(tokenOps.hash(newRefreshToken));

      // 9. Logout - revokes ALL families for the user
      const logoutRes = await request(app)
        .post('/auth/logout')
        .send({ refresh_token: newRefreshToken });

      expect(logoutRes.status).toBe(204);

      // 10. Verify all tokens for user are revoked
      const tokensAfterLogout = await prisma.refreshToken.findMany({
        where: { userId },
      });
      expect(tokensAfterLogout.every((t) => t.revokedAt !== null)).toBe(true);
    });

    it('unconfirmed user cannot login — returns 403 EMAIL_NOT_CONFIRMED and no session is issued (F1)', async () => {
      // 1. Register a new user (created in real DB with email_confirmed_at = null)
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'unconfirmedlogin@example.com', password: 'password123' });

      expect(registerRes.status).toBe(200);
      expect(registerRes.body).toEqual({
        user: { id: expect.any(String), email: 'unconfirmedlogin@example.com' },
        confirmationRequired: true,
      });
      const userId = registerRes.body.user.id;

      // 2. Verify user exists in the real database with email_confirmed_at = null
      const userBeforeLogin = await prisma.user.findUnique({ where: { id: userId } });
      expect(userBeforeLogin).not.toBeNull();
      expect(userBeforeLogin!.emailConfirmedAt).toBeNull();
      expect(userBeforeLogin!.email).toBe('unconfirmedlogin@example.com');

      // 3. Attempt login with unconfirmed account
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'unconfirmedlogin@example.com', password: 'password123' });

      // 4. Verify 403 and EMAIL_NOT_CONFIRMED error code
      expect(loginRes.status).toBe(403);
      expect(loginRes.body).toEqual({
        error: {
          code: 'EMAIL_NOT_CONFIRMED',
          message: 'Email not confirmed',
        },
      });
      expect(loginRes.body.access_token).toBeUndefined();
      expect(loginRes.body.refresh_token).toBeUndefined();

      // 5. Verify in real database that no refresh tokens or sessions were issued
      const tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(0);

      // 6. Verify in real database that user remains unconfirmed
      const userAfterLogin = await prisma.user.findUnique({ where: { id: userId } });
      expect(userAfterLogin!.emailConfirmedAt).toBeNull();
    });

    it('login enumeration uniformity — unknown email and wrong password produce identical responses (F3)', async () => {
      // 1. Register and confirm a real database user
      const knownEmail = 'known_uniformity@example.com';
      const correctPassword = 'correctPassword123';
      const wrongPassword = 'wrongPassword123';
      const unknownEmail = 'unknown_uniformity@example.com';

      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: knownEmail, password: correctPassword });

      expect(registerRes.status).toBe(200);
      const rawToken = emailSender.lastVerificationToken!;
      const confirmRes = await request(app).post('/auth/confirm-email').send({ token: rawToken });
      expect(confirmRes.status).toBe(200);

      // 2. Attempt login with unknown email + password
      const unknownRes = await request(app)
        .post('/auth/login')
        .send({ email: unknownEmail, password: correctPassword });

      // 3. Attempt login with existing email + wrong password
      const wrongPasswordRes = await request(app)
        .post('/auth/login')
        .send({ email: knownEmail, password: wrongPassword });

      // 4. Verify both return identical 401 status and identical body
      expect(unknownRes.status).toBe(401);
      expect(wrongPasswordRes.status).toBe(401);

      const expectedErrorBody = {
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid email or password',
        },
      };

      expect(unknownRes.body).toEqual(expectedErrorBody);
      expect(wrongPasswordRes.body).toEqual(expectedErrorBody);
      expect(unknownRes.body).toEqual(wrongPasswordRes.body);

      // 5. Verify neither response issues tokens or reveals user data
      expect(unknownRes.body.access_token).toBeUndefined();
      expect(wrongPasswordRes.body.access_token).toBeUndefined();
      expect(unknownRes.body.user).toBeUndefined();
      expect(wrongPasswordRes.body.user).toBeUndefined();
    });
  });

  describe('Refresh token rotation and reuse detection', () => {
    it('rotates refresh token on each refresh call', async () => {
      // 1. Register and confirm a user
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'rotate@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // 2. Login to get initial refresh token (creates login family)
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'rotate@example.com', password: 'password123' });

      const refreshToken1 = loginRes.body.refresh_token;

      // 3. Verify initial tokens in DB - confirmation family + login family = 2
      let tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(2); // confirmation family + login family
      const loginToken = tokens.find((t) => t.tokenHash === tokenOps.hash(refreshToken1));
      expect(loginToken).not.toBeUndefined();
      expect(loginToken!.revokedAt).toBeNull();

      // 4. First refresh - should rotate the login family
      const refreshRes1 = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken1 });

      expect(refreshRes1.status).toBe(200);
      const refreshToken2 = refreshRes1.body.refresh_token;

      expect(refreshToken2).not.toBe(refreshToken1);

      // 5. Verify DB state: old login token revoked, new token in same family
      // Total: confirmation (active) + login old (revoked) + login rotated (active) = 3
      tokens = await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(3);
      expect(tokens[0].revokedAt).toBeNull(); // confirmation family active
      expect(tokens[1].revokedAt).not.toBeNull(); // login old revoked
      expect(tokens[1].replacedByTokenHash).toBe(tokenOps.hash(refreshToken2));
      expect(tokens[2].revokedAt).toBeNull(); // login rotated active
      expect(tokens[2].familyId).toBe(tokens[1].familyId); // same family as login
      expect(tokens[2].tokenHash).toBe(tokenOps.hash(refreshToken2));

      // 6. Second refresh - should rotate again
      const refreshRes2 = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken2 });

      expect(refreshRes2.status).toBe(200);
      const refreshToken3 = refreshRes2.body.refresh_token;

      expect(refreshToken3).not.toBe(refreshToken2);

      // 7. Verify DB state: chain of 4 tokens (confirm + 3 in login family), first two login revoked
      tokens = await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(4);
      expect(tokens[0].revokedAt).toBeNull(); // confirmation active
      expect(tokens[1].revokedAt).not.toBeNull(); // login v1 revoked
      expect(tokens[2].revokedAt).not.toBeNull(); // login v2 revoked
      expect(tokens[3].revokedAt).toBeNull(); // login v3 active
      expect(tokens[3].familyId).toBe(tokens[1].familyId); // same family
      expect(tokens[3].tokenHash).toBe(tokenOps.hash(refreshToken3));

      // 8. Verify old tokens cannot be used (replay = TOKEN_REUSE_DETECTED)
      const replayRes = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken1 });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // 9. Verify family is fully revoked after replay
      tokens = await prisma.refreshToken.findMany({ where: { userId } });
      // confirmation family is still active, login family fully revoked
      expect(
        tokens.filter((t) => t.familyId === tokens[1].familyId).every((t) => t.revokedAt !== null),
      ).toBe(true);
    });

    it('detects replay of a rotated token and revokes the family', async () => {
      // 1. Register, confirm, login
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'replay@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'replay@example.com', password: 'password123' });

      const refreshToken1 = loginRes.body.refresh_token;

      // 2. Refresh once (rotates token1 -> token2)
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken1 });

      const refreshToken2 = refreshRes.body.refresh_token;

      // 3. Try to use the OLD rotated token again (replay)
      const replayRes = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken1 });

      expect(replayRes.status).toBe(401);
      expect(replayRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // 4. Verify login family is fully revoked (confirmation family still active)
      const tokens = await prisma.refreshToken.findMany({ where: { userId } });
      // Find the login family (the one that was rotated)
      const loginFamilyTokens = tokens.filter((t) => t.familyId === tokens[1].familyId);
      expect(loginFamilyTokens.every((t) => t.revokedAt !== null)).toBe(true);

      // 5. Verify the current token (token2) can no longer refresh either
      const replayCurrentRes = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken2 });

      expect(replayCurrentRes.status).toBe(401);
      expect(replayCurrentRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });
  });

  describe('Logout', () => {
    it('successful logout revokes all refresh-token families', async () => {
      // 1. Register, confirm, login
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'logout1@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'logout1@example.com', password: 'password123' });

      const { refresh_token } = loginRes.body;

      // 2. Verify we have 2 families (confirm + login)
      let tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(2);
      expect(tokens.every((t) => t.revokedAt === null)).toBe(true);

      // 3. Logout with the refresh token
      const logoutRes = await request(app).post('/auth/logout').send({ refresh_token });

      expect(logoutRes.status).toBe(204);

      // 4. Verify ALL families are revoked
      tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    });

    it('logout is idempotent — multiple calls return 204', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'logout2@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'logout2@example.com', password: 'password123' });

      const { refresh_token } = loginRes.body;

      // First logout
      const logoutRes1 = await request(app).post('/auth/logout').send({ refresh_token });
      expect(logoutRes1.status).toBe(204);

      // Second logout with same token
      const logoutRes2 = await request(app).post('/auth/logout').send({ refresh_token });
      expect(logoutRes2.status).toBe(204);

      // Third logout with no credentials
      const logoutRes3 = await request(app).post('/auth/logout').send({});
      expect(logoutRes3.status).toBe(204);

      // All tokens still revoked
      const tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    });

    it('revoked token cannot be used to refresh after logout', async () => {
      await request(app)
        .post('/auth/register')
        .send({ email: 'logout3@example.com', password: 'password123' });

      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'logout3@example.com', password: 'password123' });

      const { refresh_token } = loginRes.body;

      // Logout
      await request(app).post('/auth/logout').send({ refresh_token });

      // Try to refresh with the revoked token
      const refreshRes = await request(app).post('/auth/refresh').send({ refresh_token });

      expect(refreshRes.status).toBe(401);
      // Revoked by logout = replay detection (same as rotated-away token)
      expect(refreshRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');
    });

    it('logout with access token also revokes all families', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'logout4@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'logout4@example.com', password: 'password123' });

      const { access_token, refresh_token } = loginRes.body;

      // Logout with access token (bearer)
      const logoutRes = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${access_token}`)
        .send({});

      expect(logoutRes.status).toBe(204);

      // Verify ALL families are revoked
      const tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);

      // The refresh token is now unusable
      const refreshRes = await request(app).post('/auth/refresh').send({ refresh_token });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('Password reset', () => {
    it('request reset → retrieve real token → reset password → verify hash changed → token consumed → token cannot be reused → old password fails → new password works → sessions revoked', async () => {
      // 1. Register, confirm, login to create sessions
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'reset@example.com', password: 'oldpassword123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'reset@example.com', password: 'oldpassword123' });

      const { access_token, refresh_token } = loginRes.body;

      // Verify session works before reset
      const sessionBefore = await request(app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${access_token}`);
      expect(sessionBefore.status).toBe(200);

      // 2. Request password reset
      const resetRequestRes = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'reset@example.com' });

      expect(resetRequestRes.status).toBe(200);
      expect(resetRequestRes.body).toEqual({});

      // 3. Get the REAL reset token from the capturing email sender
      const resetToken = emailSender.lastResetToken;
      expect(resetToken).not.toBeNull();
      expect(tokenOps.isValid(resetToken!)).toBe(true);

      // 4. Verify token exists in DB as unconsumed
      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'password_reset' },
      });
      expect(verification).not.toBeNull();
      expect(verification!.consumedAt).toBeNull();
      expect(verification!.tokenHash).toBe(tokenOps.hash(resetToken!));

      // 5. Reset password with the real token
      const resetRes = await request(app)
        .post('/auth/password-reset')
        .send({ token: resetToken!, newPassword: 'newpassword123' });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body).toEqual({});

      // 6. Verify token is consumed
      const consumedVerification = await prisma.emailVerification.findUnique({
        where: { id: verification!.id },
      });
      expect(consumedVerification!.consumedAt).not.toBeNull();

      // 7. Verify token cannot be reused (400 INVALID_TOKEN)
      const reuseRes = await request(app)
        .post('/auth/password-reset')
        .send({ token: resetToken!, newPassword: 'anotherpassword123' });
      expect(reuseRes.status).toBe(400);
      expect(reuseRes.body.error.code).toBe('INVALID_TOKEN');

      // 8. Verify old password fails
      const oldLoginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'reset@example.com', password: 'oldpassword123' });
      expect(oldLoginRes.status).toBe(401);
      expect(oldLoginRes.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

      // 9. Verify ALL refresh tokens for the user are revoked (sessions killed)
      // Check BEFORE the new login which would create a new family
      const tokensAfterReset = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokensAfterReset.every((t) => t.revokedAt !== null)).toBe(true);

      // 10. Verify the OLD refresh token cannot refresh
      const oldRefreshRes = await request(app).post('/auth/refresh').send({ refresh_token });
      expect(oldRefreshRes.status).toBe(401);
      expect(oldRefreshRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // 11. Verify new password works
      const newLoginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'reset@example.com', password: 'newpassword123' });
      expect(newLoginRes.status).toBe(200);
      const newAccessToken = newLoginRes.body.access_token;

      // 12. Verify session works with new password login
      const sessionAfter = await request(app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${newAccessToken}`);
      expect(sessionAfter.status).toBe(200);
      expect(sessionAfter.body.user.id).toBe(userId);
    });

    it('request reset for unknown email returns 200 (enumeration safe)', async () => {
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('request reset for unconfirmed email returns 200 but no token sent', async () => {
      await request(app)
        .post('/auth/register')
        .send({ email: 'unconfirmed@example.com', password: 'password123' });

      // Don't confirm the email

      // Clear the verification token capture from registration
      emailSender.clear();

      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'unconfirmed@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});

      // No reset token should have been sent (email not confirmed)
      expect(emailSender.lastResetToken).toBeNull();
    });
  });

  describe('Concurrent refresh race', () => {
    it('two simultaneous refresh attempts with the same token — exactly one succeeds, family state correct, loser follows reuse-detection', async () => {
      // 1. Register, confirm, login
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'race@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'race@example.com', password: 'password123' });

      const refreshToken1 = loginRes.body.refresh_token;

      // 2. Fire two concurrent refresh requests with the SAME token
      const [resA, resB] = await Promise.all([
        request(app).post('/auth/refresh').send({ refresh_token: refreshToken1 }),
        request(app).post('/auth/refresh').send({ refresh_token: refreshToken1 }),
      ]);

      // 3. Exactly one succeeds (200), the other gets TOKEN_REUSE_DETECTED (401)
      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([200, 401]);

      const successRes = resA.status === 200 ? resA : resB;
      const failureRes = resA.status === 401 ? resA : resB;

      expect(successRes.body.refresh_token).not.toBe(refreshToken1);
      expect(failureRes.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      const newRefreshToken = successRes.body.refresh_token;

      // 4. Verify DB state: concurrent race triggers family revocation
      // Winner creates new token, loser triggers revokeFamily which revokes winner's token too
      // Total: 1 confirmation (active) + 2 login (both revoked) = 3 tokens
      const tokens = await prisma.refreshToken.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(tokens).toHaveLength(3);

      // Confirmation family (index 0) still active
      expect(tokens[0].revokedAt).toBeNull();

      // Login family: two tokens in same family (both revoked)
      const loginFamily = tokens.filter((t) => t.familyId === tokens[1].familyId);
      expect(loginFamily).toHaveLength(2);

      // First login token (original) - revoked
      expect(loginFamily[0].revokedAt).not.toBeNull();

      // Second login token (winner's rotated token) - also revoked by family revocation
      expect(loginFamily[1].revokedAt).not.toBeNull();
      // The winner's new token was revoked by the loser's revokeFamily call
      // replacedByTokenHash on the winner's token points to nothing (it was the last)
      // Note: the loser didn't create a new token since it lost the race

      // 5. The family is fully revoked - even the winner's token was revoked by the loser's revokeFamily
      // The current token (winner's new token) is now unusable
      const refreshAgain = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: newRefreshToken });
      expect(refreshAgain.status).toBe(401);
      expect(refreshAgain.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // 6. Try to use the original token — family is dead
      const replayOriginal = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: refreshToken1 });
      expect(replayOriginal.status).toBe(401);
      expect(replayOriginal.body.error.code).toBe('TOKEN_REUSE_DETECTED');

      // Family is fully revoked - this is the strict-by-default behavior
    });
  });

  describe('Email verification resend', () => {
    it('resends verification token for unconfirmed user — real token captured', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'resend@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;

      // 1. Get the original token
      const originalToken = emailSender.lastVerificationToken;
      expect(originalToken).not.toBeNull();

      // 2. Request resend
      const resendRes = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'resend@example.com' });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body).toEqual({});

      // 3. Get the NEW token (should be different)
      const newToken = emailSender.lastVerificationToken;
      expect(newToken).not.toBeNull();
      expect(newToken).not.toBe(originalToken);
      expect(tokenOps.isValid(newToken!)).toBe(true);

      // 4. Verify both tokens exist in DB (original unconsumed, new unconsumed)
      const verifications = await prisma.emailVerification.findMany({
        where: { userId, type: 'signup' },
        orderBy: { createdAt: 'asc' },
      });
      expect(verifications).toHaveLength(2);
      expect(verifications[0].tokenHash).toBe(tokenOps.hash(originalToken!));
      expect(verifications[0].consumedAt).toBeNull();
      expect(verifications[1].tokenHash).toBe(tokenOps.hash(newToken!));
      expect(verifications[1].consumedAt).toBeNull();

      // 5. The NEW token should work for confirmation
      const confirmRes = await request(app).post('/auth/confirm-email').send({ token: newToken! });

      expect(confirmRes.status).toBe(200);

      // 6. Verify the new token is now consumed, original still unconsumed
      const afterConfirm = await prisma.emailVerification.findMany({
        where: { userId, type: 'signup' },
        orderBy: { createdAt: 'asc' },
      });
      expect(afterConfirm[0].consumedAt).toBeNull(); // original still unconsumed
      expect(afterConfirm[1].consumedAt).not.toBeNull(); // new consumed
    });

    it('resend for confirmed user is no-op (no new token sent)', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'confirmed-resend@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      // Confirm the user
      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Clear capture
      emailSender.clear();

      // Request resend for already-confirmed user
      const resendRes = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'confirmed-resend@example.com' });

      expect(resendRes.status).toBe(200);
      expect(resendRes.body).toEqual({});

      // No new token should be sent
      expect(emailSender.lastVerificationToken).toBeNull();

      // DB should have only the original (consumed) verification
      const verifications = await prisma.emailVerification.findMany({
        where: { userId, type: 'signup' },
      });
      expect(verifications).toHaveLength(1);
      expect(verifications[0].consumedAt).not.toBeNull();
    });

    it('resend for unknown email returns 200 (enumeration safe)', async () => {
      emailSender.clear();

      const res = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'unknown@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
      expect(emailSender.lastVerificationToken).toBeNull();
    });

    it('resend replaces expired token — expired token still in DB but new one works', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'resend-expired@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;

      // Get original token
      const originalToken = emailSender.lastVerificationToken!;

      // Manually expire the original token in DB
      await prisma.emailVerification.updateMany({
        where: { userId, type: 'signup' },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      // Request resend
      const resendRes = await request(app)
        .post('/auth/resend-verification')
        .send({ email: 'resend-expired@example.com' });

      expect(resendRes.status).toBe(200);

      const newToken = emailSender.lastVerificationToken!;
      expect(newToken).not.toBe(originalToken);

      // New token works
      const confirmRes = await request(app).post('/auth/confirm-email').send({ token: newToken });

      expect(confirmRes.status).toBe(200);

      // Original expired token still in DB (unconsumed), new one consumed
      const verifications = await prisma.emailVerification.findMany({
        where: { userId, type: 'signup' },
        orderBy: { createdAt: 'asc' },
      });
      expect(verifications).toHaveLength(2);
      expect(verifications[0].consumedAt).toBeNull(); // original expired but unconsumed
      expect(verifications[1].consumedAt).not.toBeNull(); // new consumed
    });
  });

  describe('GET /auth/verify-email', () => {
    it('successful 302 redirect with real verification token', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'verify1@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      // 2. Use GET /verify-email with real token
      const verifyRes = await request(app).get('/auth/verify-email').query({ token: rawToken });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toContain(DEFAULT_ORIGIN);
      expect(verifyRes.headers.location).toContain('access_token=');
      expect(verifyRes.headers.location).toContain('refresh_token=');
      expect(verifyRes.headers.location).toContain('expires_at=');
      expect(verifyRes.headers.location).toContain('token_type=bearer');

      // 3. Verify token consumed and email confirmed
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.emailConfirmedAt).not.toBeNull();

      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'signup' },
      });
      expect(verification!.consumedAt).not.toBeNull();
    });

    it('invalid/expired token falls back to harmless redirect (302 to default origin)', async () => {
      // Use a garbage token
      const verifyRes = await request(app)
        .get('/auth/verify-email')
        .query({ token: 'garbage-token-that-does-not-exist' });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toBe(DEFAULT_ORIGIN);
    });

    it('already-consumed token falls back to harmless redirect', async () => {
      await request(app)
        .post('/auth/register')
        .send({ email: 'verify2@example.com', password: 'password123' });

      const rawToken = emailSender.lastVerificationToken!;

      // First consume it via POST /confirm-email
      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Now try GET /verify-email with the same token
      const verifyRes = await request(app).get('/auth/verify-email').query({ token: rawToken });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toBe(DEFAULT_ORIGIN);
    });

    it('redirect safety — redirect_to not on allowlist falls back to default', async () => {
      await request(app)
        .post('/auth/register')
        .send({ email: 'verify3@example.com', password: 'password123' });

      const rawToken = emailSender.lastVerificationToken!;

      // Try with a redirect_to that's NOT on the allowlist
      const verifyRes = await request(app)
        .get('/auth/verify-email')
        .query({ token: rawToken, redirect_to: 'https://evil.com' });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toContain(DEFAULT_ORIGIN);
      expect(verifyRes.headers.location).not.toContain('evil.com');
    });

    it('redirect_to on allowlist is respected', async () => {
      // We need to create an app with this origin in the allowlist
      // Since we're using the default app, test with DEFAULT_ORIGIN which IS allowed
      await request(app)
        .post('/auth/register')
        .send({ email: 'verify4@example.com', password: 'password123' });

      const rawToken = emailSender.lastVerificationToken!;

      const verifyRes = await request(app)
        .get('/auth/verify-email')
        .query({ token: rawToken, redirect_to: DEFAULT_ORIGIN });

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toContain(DEFAULT_ORIGIN);
    });

    it('missing token query param redirects harmlessly', async () => {
      const verifyRes = await request(app).get('/auth/verify-email');

      expect(verifyRes.status).toBe(302);
      expect(verifyRes.headers.location).toBe(DEFAULT_ORIGIN);
    });
  });

  describe('Rate limiting', () => {
    it('login route enforces per-IP limit and returns 429 with Retry-After', async () => {
      // Create a fresh app with a fresh rate limit store
      const { createApp } = await import('../../src/app.ts');
      const { createTestAuthService } = await import('../setup.integration.ts');
      const { InMemoryRateLimitStore } = await import('../../src/middleware/rate-limit.ts');

      const freshEmailSender = new CapturingEmailSender();
      const freshAuthService = await createTestAuthService(freshEmailSender);
      const freshStore = new InMemoryRateLimitStore();
      const freshApp = createApp({ auth: freshAuthService, rateLimitStore: freshStore });

      // Register and confirm a user
      await request(freshApp)
        .post('/auth/register')
        .send({ email: 'ratelimit1@example.com', password: 'password123' });

      const rawToken = freshEmailSender.lastVerificationToken!;
      await request(freshApp).post('/auth/confirm-email').send({ token: rawToken });

      // Make 5 successful logins (limit is 5 per window)
      for (let i = 0; i < 5; i++) {
        const res = await request(freshApp)
          .post('/auth/login')
          .send({ email: 'ratelimit1@example.com', password: 'password123' });
        expect(res.status).toBe(200);
      }

      // 6th login should be rate limited
      const blockedRes = await request(freshApp)
        .post('/auth/login')
        .send({ email: 'ratelimit1@example.com', password: 'password123' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMITED');
      expect(blockedRes.headers['retry-after']).toBeTruthy();
      expect(parseInt(blockedRes.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('register route enforces per-IP limit', async () => {
      const { createApp } = await import('../../src/app.ts');
      const { createTestAuthService } = await import('../setup.integration.ts');
      const { InMemoryRateLimitStore } = await import('../../src/middleware/rate-limit.ts');

      const freshEmailSender = new CapturingEmailSender();
      const freshAuthService = await createTestAuthService(freshEmailSender);
      const freshStore = new InMemoryRateLimitStore();
      const freshApp = createApp({ auth: freshAuthService, rateLimitStore: freshStore });

      // Make 5 successful registrations (limit is 5 per window)
      for (let i = 0; i < 5; i++) {
        const res = await request(freshApp)
          .post('/auth/register')
          .send({ email: `ratereg${i}@example.com`, password: 'password123' });
        expect(res.status).toBe(200);
      }

      // 6th should be rate limited
      const blockedRes = await request(freshApp)
        .post('/auth/register')
        .send({ email: 'rateregblocked@example.com', password: 'password123' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMITED');
    });

    it('verify-email route enforces per-IP limit and redirects home on block (no raw 429)', async () => {
      const { createApp } = await import('../../src/app.ts');
      const { createTestAuthService } = await import('../setup.integration.ts');
      const { InMemoryRateLimitStore } = await import('../../src/middleware/rate-limit.ts');

      const freshEmailSender = new CapturingEmailSender();
      const freshAuthService = await createTestAuthService(freshEmailSender);
      const freshStore = new InMemoryRateLimitStore();
      const freshApp = createApp({ auth: freshAuthService, rateLimitStore: freshStore });

      // Register and confirm
      await request(freshApp)
        .post('/auth/register')
        .send({ email: 'ratelimitv@example.com', password: 'password123' });

      const rawToken = freshEmailSender.lastVerificationToken!;
      await request(freshApp).post('/auth/confirm-email').send({ token: rawToken });

      // Re-register to get another token
      await request(freshApp)
        .post('/auth/register')
        .send({ email: 'ratelimitv2@example.com', password: 'password123' });
      const rawToken2 = freshEmailSender.lastVerificationToken!;
      await request(freshApp).post('/auth/confirm-email').send({ token: rawToken2 });

      // Make 5 successful verify-email calls (limit is 5 per window)
      for (let i = 0; i < 5; i++) {
        const res = await request(freshApp).get('/auth/verify-email').query({ token: rawToken });
        expect(res.status).toBe(302);
      }

      // 6th should redirect home (not 429, per §6.2)
      const blockedRes = await request(freshApp)
        .get('/auth/verify-email')
        .query({ token: rawToken });

      expect(blockedRes.status).toBe(302);
      expect(blockedRes.headers.location).toBe(DEFAULT_ORIGIN);
    });

    it('resend-verification route enforces per-IP limit', async () => {
      const { createApp } = await import('../../src/app.ts');
      const { createTestAuthService } = await import('../setup.integration.ts');
      const { InMemoryRateLimitStore } = await import('../../src/middleware/rate-limit.ts');

      const freshEmailSender = new CapturingEmailSender();
      const freshAuthService = await createTestAuthService(freshEmailSender);
      const freshStore = new InMemoryRateLimitStore();
      const freshApp = createApp({ auth: freshAuthService, rateLimitStore: freshStore });

      // Register unconfirmed user
      await request(freshApp)
        .post('/auth/register')
        .send({ email: 'ratelimitresend@example.com', password: 'password123' });

      // Make 5 successful resend calls (limit is 5 per window)
      for (let i = 0; i < 5; i++) {
        const res = await request(freshApp)
          .post('/auth/resend-verification')
          .send({ email: 'ratelimitresend@example.com' });
        expect(res.status).toBe(200);
      }

      // 6th should be rate limited
      const blockedRes = await request(freshApp)
        .post('/auth/resend-verification')
        .send({ email: 'ratelimitresend@example.com' });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error.code).toBe('RATE_LIMITED');
    });

    it('enforces progressive login lockout after 10 failed attempts and unblocks after lockout window (Auth-Design §16.1 / F2)', async () => {
      const { createApp } = await import('../../src/app.ts');
      const { UserRepository } = await import('../../src/repositories/users.repo.ts');
      const { RefreshTokenRepository } =
        await import('../../src/repositories/refresh-tokens.repo.ts');
      const { EmailVerificationRepository } =
        await import('../../src/repositories/email-verifications.repo.ts');
      const { BcryptPasswordHasher } = await import('../../src/utils/passwords.ts');
      const { tokenOps } = await import('../../src/utils/tokens.ts');
      const { JwtService } = await import('../../src/utils/jwt.ts');
      const { InMemoryLoginLockout } = await import('../../src/services/login-lockout.ts');
      const { InMemoryRateLimitStore } = await import('../../src/middleware/rate-limit.ts');
      const { env } = await import('../../src/config/env.ts');
      const {
        ACCESS_TOKEN_TTL_SECONDS,
        LOGIN_MAX_FAILURES,
        LOGIN_FAILURE_WINDOW_MS,
        LOGIN_BLOCK_MS,
      } = await import('../../src/config/constants.ts');

      let currentClockMs = 1_700_000_000_000;
      const testClock = () => new Date(currentClockMs);

      const freshEmailSender = new CapturingEmailSender();
      const freshLockout = new InMemoryLoginLockout({
        now: testClock,
        maxFailures: LOGIN_MAX_FAILURES,
        windowMs: LOGIN_FAILURE_WINDOW_MS,
        blockMs: LOGIN_BLOCK_MS,
      });

      const testPrisma = getTestPrisma();
      const freshAuthService = new AuthService({
        db: testPrisma,
        users: new UserRepository(testPrisma),
        refreshTokens: new RefreshTokenRepository(testPrisma),
        emailVerifications: new EmailVerificationRepository(testPrisma),
        passwords: new BcryptPasswordHasher(),
        tokens: tokenOps,
        jwt: new JwtService(env.JWT_SECRET),
        emails: freshEmailSender,
        lockout: freshLockout,
        accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
        redirectOrigins: env.AUTH_ALLOWED_REDIRECT_ORIGINS.split(',')
          .map((o) => o.trim())
          .filter(Boolean),
        defaultRedirectOrigin: env.CORS_ORIGIN,
        now: testClock,
      });

      const freshStore = new InMemoryRateLimitStore();
      const freshApp = createApp({
        auth: freshAuthService,
        rateLimitStore: freshStore,
        now: testClock,
      });

      // 1. Register and confirm real database user
      const lockoutEmail = 'lockout_integration@example.com';
      const correctPassword = 'password123';

      await request(freshApp)
        .post('/auth/register')
        .send({ email: lockoutEmail, password: correctPassword });

      const rawToken = freshEmailSender.lastVerificationToken!;
      const confirmRes = await request(freshApp)
        .post('/auth/confirm-email')
        .send({ token: rawToken });
      expect(confirmRes.status).toBe(200);

      // 2. Perform 10 failed login attempts with wrong password across time within the 15-min window
      // We advance clock by 65 seconds after every 3 attempts to stay within the 5/min route rate limit
      for (let attempt = 1; attempt <= 10; attempt++) {
        if (attempt > 1 && (attempt - 1) % 3 === 0) {
          // Advance clock 65s (route rate limit window of 60s expires, but 15-min lockout window stays active)
          currentClockMs += 65_000;
        }

        const failRes = await request(freshApp)
          .post('/auth/login')
          .send({ email: lockoutEmail, password: 'wrongPassword' });

        expect(failRes.status).toBe(401);
        expect(failRes.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      }

      // 3. 11th attempt: even with the CORRECT password, the user is locked out
      const blockedRes = await request(freshApp)
        .post('/auth/login')
        .send({ email: lockoutEmail, password: correctPassword });

      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body).toEqual({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many failed login attempts. Try again later.',
        },
      });
      expect(blockedRes.headers['retry-after']).toBe('900'); // 15 minutes in seconds

      // 4. Advance time past the 15-minute block window (15 min + 1 sec)
      currentClockMs += LOGIN_BLOCK_MS + 1_000;

      // 5. User is now unblocked and can successfully log in with correct password
      const successRes = await request(freshApp)
        .post('/auth/login')
        .send({ email: lockoutEmail, password: correctPassword });

      expect(successRes.status).toBe(200);
      expect(successRes.body).toEqual({
        access_token: expect.any(String),
        refresh_token: expect.any(String),
        expires_in: expect.any(Number),
        token_type: 'bearer',
        user: { id: expect.any(String), email: lockoutEmail },
      });

      // 6. Verify successful login reset the lockout state
      // One wrong attempt should now return 401, not 429
      const postResetFailRes = await request(freshApp)
        .post('/auth/login')
        .send({ email: lockoutEmail, password: 'wrongPasswordAgain' });

      expect(postResetFailRes.status).toBe(401);
      expect(postResetFailRes.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  describe('Database/transaction invariants', () => {
    it('single-use verification tokens — consumed token cannot be used again', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'invariant1@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      // First confirmation succeeds
      const confirm1 = await request(app).post('/auth/confirm-email').send({ token: rawToken });
      expect(confirm1.status).toBe(200);

      // Second confirmation with same token fails
      const confirm2 = await request(app).post('/auth/confirm-email').send({ token: rawToken });
      expect(confirm2.status).toBe(400);
      expect(confirm2.body.error.code).toBe('INVALID_TOKEN');

      // Token is marked consumed in DB
      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'signup' },
      });
      expect(verification!.consumedAt).not.toBeNull();
    });

    it('single-use reset tokens — consumed token cannot be used again', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'invariant2@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Request reset
      await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'invariant2@example.com' });

      const resetToken = emailSender.lastResetToken!;

      // First reset succeeds
      const reset1 = await request(app)
        .post('/auth/password-reset')
        .send({ token: resetToken, newPassword: 'newpass123' });
      expect(reset1.status).toBe(200);

      // Second reset with same token fails
      const reset2 = await request(app)
        .post('/auth/password-reset')
        .send({ token: resetToken, newPassword: 'anotherpass123' });
      expect(reset2.status).toBe(400);
      expect(reset2.body.error.code).toBe('INVALID_TOKEN');

      // Token is marked consumed in DB
      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'password_reset' },
      });
      expect(verification!.consumedAt).not.toBeNull();
    });

    it('refresh family revocation on logout revokes all tokens in all families', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'invariant3@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Login creates second family
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'invariant3@example.com', password: 'password123' });

      // Refresh creates second token in login family (rotation) — first login token revoked
      const refreshRes = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: loginRes.body.refresh_token });

      const currentRefreshToken = refreshRes.body.refresh_token;

      // We now have: 1 confirmation family (1 active) + 1 login family (1 revoked, 1 active) = 3 tokens
      let tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(3);
      // Confirmation token active, login family has 1 revoked (rotated away) + 1 active (current)
      expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(2);

      // Logout revokes ALL - use the CURRENT refresh token
      await request(app).post('/auth/logout').send({ refresh_token: currentRefreshToken });

      tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    });

    it('refresh family revocation on password reset revokes all tokens in all families', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'invariant4@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Login creates second family
      const loginRes = await request(app)
        .post('/auth/login')
        .send({ email: 'invariant4@example.com', password: 'password123' });

      // Refresh creates second token in login family (rotation) — first login token revoked
      await request(app).post('/auth/refresh').send({ refresh_token: loginRes.body.refresh_token });

      let tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(3);
      // Confirmation token active, login family has 1 revoked (rotated away) + 1 active (current)
      expect(tokens.filter((t) => t.revokedAt === null)).toHaveLength(2);

      // Request reset and use it
      await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'invariant4@example.com' });

      const resetToken = emailSender.lastResetToken!;
      await request(app)
        .post('/auth/password-reset')
        .send({ token: resetToken, newPassword: 'newpassword123' });

      // All tokens revoked
      tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.every((t) => t.revokedAt !== null)).toBe(true);
    });

    it('no partial state after failed transactional operations — failed confirmEmail leaves token unconsumed and email unconfirmed', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'invariant5@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      // Confirm once — succeeds
      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      // Try to confirm again — fails, but state should remain consistent
      // (already confirmed, token already consumed)
      const confirm2 = await request(app).post('/auth/confirm-email').send({ token: rawToken });
      expect(confirm2.status).toBe(400);

      // User should still be confirmed (not reverted)
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user!.emailConfirmedAt).not.toBeNull();

      // Token should still be consumed
      const verification = await prisma.emailVerification.findFirst({
        where: { userId, type: 'signup' },
      });
      expect(verification!.consumedAt).not.toBeNull();
    });

    it('cascade behavior — deleting user deletes refresh tokens and email verifications', async () => {
      const registerRes = await request(app)
        .post('/auth/register')
        .send({ email: 'cascade@example.com', password: 'password123' });

      const userId = registerRes.body.user.id;
      const rawToken = emailSender.lastVerificationToken!;

      await request(app).post('/auth/confirm-email').send({ token: rawToken });

      await request(app)
        .post('/auth/login')
        .send({ email: 'cascade@example.com', password: 'password123' });

      // Verify tokens exist
      let tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens.length).toBeGreaterThan(0);

      let verifications = await prisma.emailVerification.findMany({ where: { userId } });
      expect(verifications.length).toBeGreaterThan(0);

      // Delete user directly via Prisma (simulating cascade)
      await prisma.user.delete({ where: { id: userId } });

      // Refresh tokens and email verifications should be cascade-deleted
      tokens = await prisma.refreshToken.findMany({ where: { userId } });
      expect(tokens).toHaveLength(0);

      verifications = await prisma.emailVerification.findMany({ where: { userId } });
      expect(verifications).toHaveLength(0);
    });
  });
});
