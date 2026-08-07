import { randomUUID } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { env } from '../config/env.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  RESET_VERIFICATION_TTL_MS,
  SIGNUP_VERIFICATION_TTL_MS,
} from '../config/constants.js';
import { prisma } from '../lib/prisma.js';
import { isUniqueViolation } from '../lib/prisma-errors.js';
import { EmailVerificationRepository } from '../repositories/email-verifications.repo.js';
import { RefreshTokenRepository } from '../repositories/refresh-tokens.repo.js';
import { UserRepository } from '../repositories/users.repo.js';
import { AppError } from '../utils/errors.js';
import { ConsoleEmailSender, type EmailSender } from '../utils/emails.js';
import { JwtService, type JwtSigner } from '../utils/jwt.js';
import { BcryptPasswordHasher, type PasswordHasher } from '../utils/passwords.js';
import { tokenOps, type TokenOps } from '../utils/tokens.js';
import { assertEmailValid, assertPasswordValid, normalizeEmail } from '../utils/validate.js';
import { logger } from '../utils/logger.js';
import { InMemoryLoginLockout, type LoginLockoutStore } from './login-lockout.js';

/**
 * Authentication service layer (Sprint 2B Milestone 3; Auth-Design §2-§12).
 *
 * Composes the Milestone-1 models and Milestone-2 repositories into the flows
 * the API exposes. Every credential proof is delivered to this layer as a raw
 * token/password; request-boundary concerns (parsing, transport-level rate
 * limiting, request-id correlation) live in the Milestone-4 routes/middleware,
 * NOT here.
 *
 * Security posture (see Auth-Design for rationale):
 *  - refresh rotation and family reuse-detection run inside one transaction
 *    (`revokeById` is the atomic claim, so exactly one racing rotation wins);
 *  - login timing is equalized for unknown emails via a dummy bcrypt compare;
 *  - email-confirmation / password-reset tokens are single-use and consumed
 *    atomically, so a double-click cannot produce a double effect;
 *  - redirect_to is validated against an origin allowlist (malformed or
 *    unknown values silently fall back to the default origin).
 */

export interface SessionUser {
  id: string;
  email: string;
}

/** GoTrue-parity session shape returned by register/confirm/login/refresh (§2.4). */
export interface Session {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: 'bearer';
  user: SessionUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  /** Optional frontend origin to return to after confirmation (allowlist-checked). */
  emailRedirectTo?: string;
}

export interface RegisterResult {
  user: SessionUser;
  /** True when a confirmation email was (re-)issued; false once already confirmed. */
  confirmationRequired: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Shape for GET /auth/session — derived purely from the presented access token. */
export interface SessionFromAccess {
  user: SessionUser;
  expires_at: number;
}

export interface AuthServiceDeps {
  db: PrismaClient;
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  emailVerifications: EmailVerificationRepository;
  passwords: PasswordHasher;
  tokens: TokenOps;
  jwt: JwtSigner;
  emails: EmailSender;
  lockout: LoginLockoutStore;
  /** Access-token TTL, surfaced as the session `expires_in` — keep in sync with jwt. */
  accessTokenTtlSeconds: number;
  /** Origins a `redirect_to` may point at. Empty-set denies every explicit redirect. */
  redirectOrigins: string[];
  defaultRedirectOrigin: string;
  now: () => Date;
  /** Profile-bootstrap seam: activates when the profiles table lands (Phase 2). */
  bootstrapProfile?: (userId: string) => Promise<void>;
}

const noopBootstrap = async (): Promise<void> => undefined;

/** Parses the allowlist env (comma-separated), falling back to CORS_ORIGIN. */
function defaultRedirectOrigins(): string[] {
  const configured = env.AUTH_ALLOWED_REDIRECT_ORIGINS.trim();
  const source = configured.length > 0 ? configured : env.CORS_ORIGIN;
  return source
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export class AuthService {
  private readonly db: PrismaClient;
  private readonly users: UserRepository;
  private readonly refreshTokens: RefreshTokenRepository;
  private readonly emailVerifications: EmailVerificationRepository;
  private readonly passwords: PasswordHasher;
  private readonly tokens: TokenOps;
  private readonly jwt: JwtSigner;
  private readonly emails: EmailSender;
  private readonly lockout: LoginLockoutStore;
  private readonly accessTokenTtlSeconds: number;
  private readonly redirectOrigins: string[];
  private readonly defaultRedirectOrigin: string;
  private readonly now: () => Date;
  private readonly bootstrapProfile: (userId: string) => Promise<void>;

  constructor(deps: Partial<AuthServiceDeps> = {}) {
    this.db = deps.db ?? prisma;
    this.users = deps.users ?? new UserRepository(this.db);
    this.refreshTokens = deps.refreshTokens ?? new RefreshTokenRepository(this.db);
    this.emailVerifications = deps.emailVerifications ?? new EmailVerificationRepository(this.db);
    this.passwords = deps.passwords ?? new BcryptPasswordHasher();
    this.tokens = deps.tokens ?? tokenOps;
    this.jwt = deps.jwt ?? new JwtService(env.JWT_SECRET);
    this.emails =
      deps.emails ??
      new ConsoleEmailSender({
        apiPublicOrigin: env.API_PUBLIC_ORIGIN,
        printLinks: env.NODE_ENV !== 'production',
      });
    this.lockout = deps.lockout ?? new InMemoryLoginLockout();
    this.accessTokenTtlSeconds = deps.accessTokenTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
    const origins = deps.redirectOrigins ?? defaultRedirectOrigins();
    this.redirectOrigins = origins;
    this.defaultRedirectOrigin = deps.defaultRedirectOrigin ?? origins[0] ?? env.CORS_ORIGIN;
    this.now = deps.now ?? (() => new Date());
    this.bootstrapProfile = deps.bootstrapProfile ?? noopBootstrap;
  }

  /* ---------------------------------------------------------------------- */
  /* Signup                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Creates an unconfirmed user and issues a single-use confirmation token
   * (§2.1). An already-confirmed account returns the same response without
   * sending anything (account-enumeration parity, §2.2). Unconfirmed
   * re-registrations are idempotent: they rotate the token and re-email.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = normalizeEmail(input.email);
    assertEmailValid(email);
    assertPasswordValid(input.password);

    const existing = await this.users.findByEmail(email);
    // Pay the bcrypt cost before the confirmed-account early return so response
    // timing does not reveal whether the address is already confirmed (§2.2/T5 —
    // the same equalization login applies at §3.1).
    const passwordHash = await this.passwords.hash(input.password);
    if (existing?.emailConfirmedAt) {
      return { user: this.publicUser(existing), confirmationRequired: true };
    }

    let user = existing;
    if (!user) {
      try {
        user = await this.users.create({ email, passwordHash });
      } catch (error) {
        // Two submits racing the unique email constraint: the loser's row was
        // created by the winner. Fall through to the unconfirmed-user path
        // (rotate the token) instead of surfacing a P2002 500.
        if (!isUniqueViolation(error)) throw error;
        user = await this.users.findByEmail(email);
        if (!user) throw error;
        if (user.emailConfirmedAt) {
          return { user: this.publicUser(user), confirmationRequired: true };
        }
      }
    }
    // Profile-bootstrap seam: the Phase-2 `on_user_created` trigger (with a
    // transactional fallback) inserts the profile row. No-op until that lands.
    if (!existing) {
      await this.bootstrapProfile(user.id);
    }

    const token = this.tokens.generate();
    const expiresAt = new Date(this.now().getTime() + SIGNUP_VERIFICATION_TTL_MS);
    await this.emailVerifications.create({
      userId: user.id,
      type: 'signup',
      tokenHash: this.tokens.hash(token),
      expiresAt,
    });
    await this.emails.sendVerificationEmail({
      to: user.email,
      token,
      redirectTo: this.resolveRedirectOrigin(input.emailRedirectTo),
    });

    return { user: this.publicUser(user), confirmationRequired: true };
  }

  /* ---------------------------------------------------------------------- */
  /* Login                                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Password login (§3). Timing-equalized for unknown emails; 10 failed
   * attempts inside 15 minutes block the address for 15 minutes (§16.1).
   * An unconfirmed user who supplies the correct password gets a uniform 403
   * (the email drives re-confirmation, not an error response).
   */
  async login(input: LoginInput): Promise<Session> {
    const email = normalizeEmail(input.email);
    assertEmailValid(email);
    // A malformed password can't be a real credential and would make bcryptjs
    // throw a raw Error (500). Reject it as a uniform 400; the 8–72 byte
    // *policy* applies at set time, so a short-but-real attempt still flows
    // through bcrypt to the uniform 401 (§3.1).
    if (typeof input.password !== 'string' || input.password.length === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A password is required');
    }

    if (this.lockout.isBlocked(email)) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many failed login attempts. Try again later.');
    }

    const user = await this.users.findByEmail(email);
    // Always pay one bcrypt compare — against the dummy hash for unknown
    // emails — so timing does not reveal whether the address is registered.
    const verified = await this.passwords.verify(
      input.password,
      user?.passwordHash ?? this.passwords.dummyHash(),
    );
    if (!user || !verified) {
      this.lockout.registerFailure(email);
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid email or password');
    }

    if (!user.emailConfirmedAt) {
      throw new AppError(403, 'EMAIL_NOT_CONFIRMED', 'Email not confirmed');
    }
    // Only a genuinely successful login clears the progressive lockout — a
    // correct password on an unconfirmed account must not wipe the failure
    // counter (re-confirmation is driven by email, not a reset here).
    this.lockout.reset(email);

    return this.issueSession(user, this.now());
  }

  /* ---------------------------------------------------------------------- */
  /* Refresh (rotation + reuse detection)                                     */
  /* ---------------------------------------------------------------------- */

  /**
   * Rotates a refresh token (§5). One transaction atomically claims the old
   * token (revoke + replacement chain) and inserts the new one. A token that is
   * missing or expired is a plain 401; a *revoked* token is a replay signal and
   * revokes the entire family (§5.2, TOKEN_REUSE_DETECTED).
   */
  async refresh(refreshToken: string): Promise<Session> {
    if (!this.tokens.isValid(refreshToken)) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired refresh token');
    }

    const record = await this.refreshTokens.findByTokenHash(this.tokens.hash(refreshToken));
    const now = this.now();

    if (!record) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired refresh token');
    }

    // Revoked = replay of a rotated-away (or logged-out) token → kill the family.
    // Checked BEFORE expiry so a replay of an expired-and-revoked token still
    // emits the reuse security event (§5.2): the 401 body is identical either
    // way, but the family revocation + warn must survive.
    if (record.revokedAt) {
      await this.refreshTokens.revokeFamily(record.familyId);
      logger.warn(
        { userId: record.userId, familyId: record.familyId },
        'refresh token reuse detected — refresh family revoked',
      );
      throw new AppError(401, 'TOKEN_REUSE_DETECTED', 'Invalid or expired refresh token');
    }

    if (record.expiresAt.getTime() <= now.getTime()) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired refresh token');
    }

    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid or expired refresh token');
    }
    if (!user.emailConfirmedAt) {
      throw new AppError(403, 'EMAIL_NOT_CONFIRMED', 'Email not confirmed');
    }

    const nextToken = this.tokens.generate();
    const nextHash = this.tokens.hash(nextToken);
    const nextExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);

    // `revokeById` touches only a still-active row, so exactly one racing
    // rotation wins. A loser (already revoked by a sibling request) means reuse
    // by the strict-by-default rule; the family revocation must survive, so the
    // flag is inspected AFTER the transaction commits.
    let reuse = false;
    await this.db.$transaction(async (tx) => {
      const rt = new RefreshTokenRepository(tx);
      const won = await rt.revokeById(record.id, nextHash);
      if (!won) {
        await rt.revokeFamily(record.familyId);
        reuse = true;
      } else {
        await rt.create({
          userId: record.userId,
          familyId: record.familyId,
          tokenHash: nextHash,
          expiresAt: nextExpiresAt,
        });
      }
    });

    if (reuse) {
      logger.warn(
        { userId: record.userId, familyId: record.familyId },
        'concurrent refresh rotation detected — refresh family revoked',
      );
      throw new AppError(401, 'TOKEN_REUSE_DETECTED', 'Invalid or expired refresh token');
    }

    const accessToken = await this.jwt.sign(
      { id: user.id, email: user.email },
      now,
      this.accessTokenTtlSeconds,
    );
    return {
      access_token: accessToken,
      refresh_token: nextToken,
      expires_in: this.accessTokenTtlSeconds,
      token_type: 'bearer',
      user: this.publicUser(user),
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Logout                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Global-scope logout (§8): revokes every active refresh family for the user
   * (GoTrue parity). Idempotent — revoking an already-revoked set is a no-op,
   * so the response is always success.
   */
  async logout(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
  }

  /** Resolves a user id from a raw refresh token, or null when unusable. */
  async resolveUserIdFromRefreshToken(refreshToken: string): Promise<string | null> {
    if (!this.tokens.isValid(refreshToken)) return null;
    const record = await this.refreshTokens.findByTokenHash(this.tokens.hash(refreshToken));
    if (!record || record.revokedAt || record.expiresAt.getTime() <= this.now().getTime()) {
      return null;
    }
    return record.userId;
  }

  /* ---------------------------------------------------------------------- */
  /* Email confirmation                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Confirms an email and, in the same transaction, consumes the token and
   * issues a fresh session (new refresh family) (§6.5). Single-use: an already
   * consumed, expired, or wrong-kind token is a uniform 400 INVALID_TOKEN.
   */
  async confirmEmail(token: string): Promise<Session> {
    const record = await this.findVerificationToken(token, 'signup');
    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
    }

    let session!: Session;
    await this.db.$transaction(async (tx) => {
      const ev = new EmailVerificationRepository(tx);
      const consumed = await ev.consumeById(record.id);
      if (!consumed) {
        throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
      }
      await new UserRepository(tx).confirmEmail(user.id);
      session = await this.issueSession(user, this.now(), new RefreshTokenRepository(tx));
    });
    return session;
  }

  /**
   * Builds the hash-fragment redirect that ends the browser confirmation flow
   * (§6.5): `<origin>/#access_token=…&refresh_token=…&expires_at=…&token_type=…`.
   * `redirectTo` must be an allowlisted origin; anything else falls back to the
   * default (never an error — the email itself already narrowed it).
   */
  async buildVerificationRedirect(
    redirectTo: string | undefined,
    session: Session,
  ): Promise<string> {
    const origin = this.resolveRedirectOrigin(redirectTo);
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: String(Math.floor(this.now().getTime() / 1000) + this.accessTokenTtlSeconds),
      token_type: session.token_type,
    }).toString();
    return `${origin}/#${fragment}`;
  }

  /**
   * Re-emails a signup confirmation token for an unconfirmed user (§6.3).
   * Uniform success — never reveals whether the address is registered.
   */
  async resendVerification(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    assertEmailValid(normalized);

    const user = await this.users.findByEmail(normalized);
    if (user && !user.emailConfirmedAt) {
      const token = this.tokens.generate();
      const expiresAt = new Date(this.now().getTime() + SIGNUP_VERIFICATION_TTL_MS);
      await this.emailVerifications.create({
        userId: user.id,
        type: 'signup',
        tokenHash: this.tokens.hash(token),
        expiresAt,
      });
      await this.emails.sendVerificationEmail({
        to: user.email,
        token,
        redirectTo: this.defaultRedirectOrigin,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Password reset                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * Emails a single-use reset token to confirmed accounts only (§7.2).
   * Uniform 200 for every structurally valid email.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    assertEmailValid(normalized);

    const user = await this.users.findByEmail(normalized);
    if (user?.emailConfirmedAt) {
      const token = this.tokens.generate();
      const expiresAt = new Date(this.now().getTime() + RESET_VERIFICATION_TTL_MS);
      await this.emailVerifications.create({
        userId: user.id,
        type: 'password_reset',
        tokenHash: this.tokens.hash(token),
        expiresAt,
      });
      const resetUrl = `${this.defaultRedirectOrigin}/reset-password?token=${encodeURIComponent(token)}`;
      await this.emails.sendPasswordResetEmail({ to: user.email, token, resetUrl });
    }
  }

  /**
   * Sets a new password from a valid reset token (§7.3). Atomically consumes
   * the token, updates the hash, and revokes every refresh family so all
   * existing sessions die.
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.findVerificationToken(token, 'password_reset');
    const user = await this.users.findById(record.userId);
    if (!user) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired reset token');
    }

    assertPasswordValid(newPassword);
    const passwordHash = await this.passwords.hash(newPassword);

    await this.db.$transaction(async (tx) => {
      const ev = new EmailVerificationRepository(tx);
      const consumed = await ev.consumeById(record.id);
      if (!consumed) {
        throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired reset token');
      }
      await new UserRepository(tx).updatePasswordHash(user.id, passwordHash);
      await new RefreshTokenRepository(tx).revokeAllForUser(user.id);
    });

    // A successful reset also clears any progressive lockout on the account.
    this.lockout.reset(user.email);
  }

  /* ---------------------------------------------------------------------- */
  /* Session introspection                                                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Returns the session described by a presented access token (§9). The token
   * is verified (signature, `type: "access"`, UUID `sub`) — callers may cache
   * the user id, but must not trust the client for the user's current state.
   */
  async getSession(accessToken: string): Promise<SessionFromAccess> {
    const claims = await this.jwt.verify(accessToken);
    return {
      user: { id: claims.sub, email: claims.email },
      expires_at: claims.exp,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                                */
  /* ---------------------------------------------------------------------- */

  /** Issues a refresh-token row (new family) plus a fresh access JWT (§2.4). */
  private async issueSession(
    user: User,
    now: Date,
    refreshTokens: RefreshTokenRepository = this.refreshTokens,
  ): Promise<Session> {
    const refreshToken = this.tokens.generate();
    await refreshTokens.create({
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: this.tokens.hash(refreshToken),
      expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    const accessToken = await this.jwt.sign(
      { id: user.id, email: user.email },
      now,
      this.accessTokenTtlSeconds,
    );
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: this.accessTokenTtlSeconds,
      token_type: 'bearer',
      user: this.publicUser(user),
    };
  }

  /**
   * Loads a verification token, requiring it to exist, be unconsumed,
   * unexpired, and of the expected kind. Uniform 400 INVALID_TOKEN otherwise.
   */
  private async findVerificationToken(
    token: string,
    expectedType: 'signup' | 'password_reset',
  ): Promise<NonNullable<Awaited<ReturnType<EmailVerificationRepository['findByTokenHash']>>>> {
    if (!this.tokens.isValid(token)) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
    }
    const record = await this.emailVerifications.findByTokenHash(this.tokens.hash(token));
    if (
      !record ||
      record.type !== expectedType ||
      record.consumedAt ||
      record.expiresAt.getTime() <= this.now().getTime()
    ) {
      throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
    }
    return record;
  }

  /**
   * Resolves a client-supplied redirect_to against the origin allowlist
   * (§6.4, D-A6). Malformed URLs, unknown origins, and missing values all fall
   * back to the default origin — never an error.
   */
  private resolveRedirectOrigin(redirectTo: string | undefined): string {
    if (redirectTo) {
      try {
        const origin = new URL(redirectTo).origin;
        if (this.redirectOrigins.includes(origin)) return origin;
      } catch {
        // Malformed URL → default origin.
      }
    }
    return this.defaultRedirectOrigin;
  }

  private publicUser(user: User): SessionUser {
    return { id: user.id, email: user.email };
  }
}
