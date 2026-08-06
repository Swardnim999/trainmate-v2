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
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

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

  // Terminal handlers — order matters: 404 first, then the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
