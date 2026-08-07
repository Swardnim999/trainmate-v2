import express from 'express';
import type { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env.js';
import { DEFAULT_BODY_LIMIT } from './config/constants.js';
import { httpLogger } from './middleware/http-logger.js';
import { notFoundHandler } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { healthRouter } from './routes/health.routes.js';
import { createAuthRouter } from './routes/auth.routes.js';
import type { RateLimitStore } from './middleware/rate-limit.js';
import type { AuthService } from './services/auth.service.js';

/** Parse a comma-separated CORS_ORIGIN into an origin allowlist. */
function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Assemble the Express application. Kept free of side effects (no `listen`)
 * so the test harness and the HTTP server in `index.ts` share one factory.
 *
 * Middleware order matters: security + plumbing first so every response
 * (including errors) gets the headers and request id, body parsing with a
 * hard size cap, then routes, then the terminal 404 + error handlers.
 *
 * `options.auth` / `options.rateLimitStore` are test seams: integration tests
 * inject a fake AuthService (no test Postgres exists yet) and a fresh rate-limit
 * store; production omits them and gets the real service + shared in-memory store.
 */
export function createApp(
  options: { auth?: AuthService; rateLimitStore?: RateLimitStore } = {},
): Express {
  const app = express();

  app.disable('x-powered-by');

  // Behind a reverse proxy/LB, trust N hops so per-IP rate-limit keys resolve to
  // the real client rather than the proxy (§16.3 Phase-14 check). Default 0 =
  // direct connections; X-Forwarded-For is ignored, so clients can't spoof the
  // limit key. Set to the true hop count when deployed behind a proxy.
  if (env.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: parseCorsOrigins(env.CORS_ORIGIN),
      credentials: true,
    }),
  );
  app.use(compression());

  // Request id + structured request logging (auth headers redacted).
  app.use(httpLogger);

  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));

  // Routes.
  app.use('/health', healthRouter);
  app.use(
    '/auth',
    createAuthRouter({ auth: options.auth, rateLimitStore: options.rateLimitStore }),
  );

  // Terminal handlers — order matters: 404 first, then the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
