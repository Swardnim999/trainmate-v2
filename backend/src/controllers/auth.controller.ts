import type { Request, Response } from 'express';
import { type AuthService, type LoginInput, type RegisterInput } from '../services/auth.service.js';
import { extractBearerToken } from '../utils/bearer-token.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validated } from '../middleware/validate.js';

/**
 * Auth HTTP controller (Sprint 2B M4).
 *
 * Deliberately thin: input is validated by route-boundary Zod middleware *before*
 * the handler runs, so each method only (1) reads the already-validated input,
 * (2) calls AuthService, and (3) maps the result/error to an HTTP response. All
 * business rules — hashing, lockout, session issuance/rotation, verification
 * token lifecycle — live in AuthService; every unhandled AppError propagates to
 * the centralized error handler for the standard envelope. The two deliberate
 * exceptions to "let it propagate" are the browser-facing flows:
 *  - verifyEmail translates a stale/bad link (400 INVALID_TOKEN) into a harmless
 *    redirect to the default origin (§6.2) instead of a raw error envelope.
 *  - logout must always answer 204 (§8.4), so it resolves whichever credential
 *    the client presented and treats an unverifiable one as "nothing to revoke".
 *
 * Methods are arrow-function class properties (not prototype methods) so Express
 * can pass them to a route by reference without `this` being lost.
 */

export interface AuthControllerDeps {
  auth: AuthService;
  /** Default frontend origin used for the harmless verify-email fallback redirect. */
  defaultRedirectOrigin: string;
}

export class AuthController {
  private readonly auth: AuthService;
  private readonly defaultRedirectOrigin: string;

  constructor(deps: AuthControllerDeps) {
    this.auth = deps.auth;
    this.defaultRedirectOrigin = deps.defaultRedirectOrigin;
  }

  register = async (req: Request, res: Response): Promise<void> => {
    const input = validated<RegisterInput>(req, 'body');
    const result = await this.auth.register(input);
    res.status(200).json(result);
  };

  login = async (req: Request, res: Response): Promise<void> => {
    const input = validated<LoginInput>(req, 'body');
    const session = await this.auth.login(input);
    res.status(200).json(session);
  };

  refresh = async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = validated<{ refresh_token: string }>(req, 'body');
    const session = await this.auth.refresh(refresh_token);
    res.status(200).json(session);
  };

  confirmEmail = async (req: Request, res: Response): Promise<void> => {
    const { token } = validated<{ token: string }>(req, 'body');
    // Programmatic twin of GET /verify-email: stays strict (§18.2) — a bad,
    // expired, or already-consumed token is a 400 envelope, not a redirect.
    const session = await this.auth.confirmEmail(token);
    res.status(200).json(session);
  };

  resendVerification = async (req: Request, res: Response): Promise<void> => {
    const { email } = validated<{ email: string }>(req, 'body');
    await this.auth.resendVerification(email);
    // Uniform 200 for existing and unknown addresses alike — never an existence signal.
    res.status(200).json({});
  };

  requestPasswordReset = async (req: Request, res: Response): Promise<void> => {
    const { email } = validated<{ email: string }>(req, 'body');
    await this.auth.requestPasswordReset(email);
    res.status(200).json({});
  };

  resetPassword = async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword } = validated<{ token: string; newPassword: string }>(req, 'body');
    await this.auth.resetPassword(token, newPassword);
    res.status(200).json({});
  };

  getSession = async (req: Request, res: Response): Promise<void> => {
    // Behind `authenticate`, so the header is guaranteed present and valid; the
    // token is re-extracted so AuthService remains the single verifier.
    const token = extractBearerToken(req.headers.authorization) ?? '';
    const session = await this.auth.getSession(token);
    res.status(200).json(session);
  };

  logout = async (req: Request, res: Response): Promise<void> => {
    const { refresh_token } = validated<{ refresh_token?: string }>(req, 'body');
    const userId = await this.resolveLogoutUser(req, refresh_token);
    if (userId) await this.auth.logout(userId);
    res.status(204).end();
  };

  verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const { token, redirect_to } = validated<{ token: string; redirect_to?: string }>(req, 'query');
    try {
      const session = await this.auth.confirmEmail(token);
      const url = await this.auth.buildVerificationRedirect(redirect_to, session);
      res.redirect(302, url);
    } catch (err) {
      // A re-clicked, expired, or garbage link must never surface a raw error to
      // a browser tab (§6.2) — redirect home instead. Everything else (500s, …)
      // still propagates to the error handler.
      if (err instanceof AppError && err.statusCode === 400 && err.code === 'INVALID_TOKEN') {
        logger.info(
          { requestId: req.id },
          'verify-email link invalid or expired — redirecting harmlessly',
        );
        res.redirect(302, this.defaultRedirectOrigin);
        return;
      }
      throw err;
    }
  };

  /** Resolves the user behind a logout request: refresh token first, else access
   * token; an unverifiable credential yields `null` (idempotent 204, §8.4). */
  private readonly resolveLogoutUser = async (
    req: Request,
    refreshToken?: string,
  ): Promise<string | null> => {
    if (refreshToken) {
      return this.auth.resolveUserIdFromRefreshToken(refreshToken);
    }
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return null;
    try {
      const session = await this.auth.getSession(token);
      return session.user.id;
    } catch {
      return null;
    }
  };
}
