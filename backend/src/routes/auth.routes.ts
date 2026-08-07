import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import {
  RATE_LIMIT_LOGIN_LIMIT,
  RATE_LIMIT_REFRESH_LIMIT,
  RATE_LIMIT_REGISTER_LIMIT,
  RATE_LIMIT_RESEND_LIMIT,
  RATE_LIMIT_RESET_LIMIT,
  RATE_LIMIT_RESET_REQUEST_LIMIT,
  RATE_LIMIT_VERIFY_LIMIT,
  RATE_LIMIT_WINDOW_MS,
} from '../config/constants.js';
import { AuthController } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import {
  createRateLimiter,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from '../middleware/rate-limit.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { AuthService } from '../services/auth.service.js';
import {
  confirmEmailSchema,
  loginSchema,
  logoutSchema,
  registerSchema,
  refreshSchema,
  requestPasswordResetSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailQuerySchema,
} from '../validation/auth.schemas.js';

export interface AuthRouterDeps {
  /** Override the service (integration tests inject a fake; prod uses the real one). */
  auth?: AuthService;
  /** Fresh store per test; prod gets a shared in-memory store (§16.2 swap point). */
  rateLimitStore?: RateLimitStore;
  /** Injectable clock for deterministic rate-limit tests. */
  now?: () => Date;
}

/**
 * Mirrors AuthService.defaultRedirectOrigins() so the browser verify-email
 * fallback and the service agree on the default origin (§6.4). Exported for the
 * regression test that pins this against the service's own resolution — a
 * divergence here would silently desync the verify-email fallback.
 */
export function defaultRedirectOrigin(): string {
  const configured = env.AUTH_ALLOWED_REDIRECT_ORIGINS.trim();
  const source = configured.length > 0 ? configured : env.CORS_ORIGIN;
  const first = source
    .split(',')
    .map((origin) => origin.trim())
    .find((origin) => origin.length > 0);
  return first ?? env.CORS_ORIGIN;
}

/** Rate-limit key namespaces keep per-route and per-key windows independent
 * (register and login for the same email/IP are different buckets, §16.1). */
const ipKey = (route: string) => (req: Request) => `${route}:ip:${req.ip ?? 'unknown'}`;
const emailKey = (route: string) => (req: Request) => {
  const email = (req.validated?.body as { email?: string } | undefined)?.email;
  return `${route}:email:${email ?? ''}`;
};

/**
 * Assemble the `/auth` router (Auth-Design §12). Every handler is gated by
 * route-boundary Zod validation *before* rate limiting, so the per-email key is
 * always the canonical address and malformed input never spends bcrypt budget.
 * Rate limiters run ahead of the controller to shed traffic before any bcrypt
 * work (login lockout at the service layer is the second, coarser stage).
 */
export function createAuthRouter(deps: AuthRouterDeps = {}): Router {
  const router = Router();
  const auth = deps.auth ?? new AuthService();
  const fallbackOrigin = defaultRedirectOrigin();
  const controller = new AuthController({ auth, defaultRedirectOrigin: fallbackOrigin });
  const store = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const now = deps.now ?? (() => new Date());

  const ipLimiter = (
    route: string,
    limit: number,
    onBlocked?: (req: Request, res: Response) => void,
    namespace?: string,
  ) =>
    createRateLimiter({
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      store,
      now,
      keyGenerator: ipKey(route),
      onBlocked,
      namespace,
    });
  const emailLimiter = (route: string, limit: number, namespace?: string) =>
    createRateLimiter({
      limit,
      windowMs: RATE_LIMIT_WINDOW_MS,
      store,
      now,
      keyGenerator: emailKey(route),
      namespace,
    });

  router.post(
    '/register',
    validateBody(registerSchema),
    ipLimiter('register', RATE_LIMIT_REGISTER_LIMIT, undefined, 'register:ip'),
    controller.register,
  );

  router.post(
    '/login',
    validateBody(loginSchema),
    ipLimiter('login', RATE_LIMIT_LOGIN_LIMIT, undefined, 'login:ip'),
    emailLimiter('login', RATE_LIMIT_LOGIN_LIMIT, 'login:email'),
    controller.login,
  );

  router.post(
    '/refresh',
    validateBody(refreshSchema),
    ipLimiter('refresh', RATE_LIMIT_REFRESH_LIMIT, undefined, 'refresh:ip'),
    controller.refresh,
  );

  router.post('/logout', validateBody(logoutSchema), controller.logout);

  router.get('/session', authenticate, controller.getSession);

  router.post(
    '/confirm-email',
    validateBody(confirmEmailSchema),
    ipLimiter('confirm', RATE_LIMIT_VERIFY_LIMIT, undefined, 'confirm:ip'),
    controller.confirmEmail,
  );

  router.get(
    '/verify-email',
    validateQuery(verifyEmailQuerySchema),
    // §6.2: a browser click must never surface a raw error in the tab — even a
    // rate-limited link redirects home (the strict programmatic twin is POST
    // /confirm-email, which keeps the JSON envelope).
    ipLimiter(
      'verify',
      RATE_LIMIT_VERIFY_LIMIT,
      (_req, res) => {
        res.redirect(302, fallbackOrigin);
      },
      'verify:ip',
    ),
    controller.verifyEmail,
    // Boundary-validation failures on this route (malformed/duplicate query
    // params, an over-long redirect_to) would otherwise render a 400 envelope in
    // the browser; redirect home like the stale-link path. Server errors still
    // propagate to the global handler.
    (err: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof ZodError) {
        res.redirect(302, fallbackOrigin);
        return;
      }
      next(err);
    },
  );

  router.post(
    '/resend-verification',
    validateBody(resendVerificationSchema),
    ipLimiter('resend', RATE_LIMIT_RESEND_LIMIT, undefined, 'resend:ip'),
    controller.resendVerification,
  );

  router.post(
    '/password-reset/request',
    validateBody(requestPasswordResetSchema),
    ipLimiter('reset-request', RATE_LIMIT_RESET_REQUEST_LIMIT, undefined, 'reset-request:ip'),
    controller.requestPasswordReset,
  );

  router.post(
    '/password-reset',
    validateBody(resetPasswordSchema),
    ipLimiter('reset', RATE_LIMIT_RESET_LIMIT, undefined, 'reset:ip'),
    controller.resetPassword,
  );

  return router;
}
