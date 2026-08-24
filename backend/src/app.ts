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
import { createModerationRouter } from './routes/moderation.routes.js';
import { createProfileRouter } from './routes/profile.routes.js';
import { createJourneyRouter } from './routes/journeys.routes.js';
import { createTrainRouter } from './routes/trains.routes.js';
import { createRequestRouter } from './routes/requests.routes.js';
import { createConversationRouter } from './routes/conversations.routes.js';
import { ConversationController } from './controllers/conversation.controller.js';
import { MessageController } from './controllers/message.controller.js';
import type { RateLimitStore } from './middleware/rate-limit.js';
import type { AuthService } from './services/auth.service.js';
import type { ModerationService } from './services/moderation.service.js';
import type { ProfileService } from './services/profile.service.js';
import type { JourneyService } from './services/journey.service.js';
import type { TrainService } from './services/train.service.js';
import type { RequestService } from './services/request.service.js';
import type { ConversationService } from './services/conversation.service.js';
import type { MessageService } from './services/message.service.js';

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
  options: {
    auth?: AuthService;
    moderation?: ModerationService;
    profileService?: ProfileService;
    journeyService?: JourneyService;
    trainService?: TrainService;
    requestService?: RequestService;
    conversationService?: ConversationService;
    messageService?: MessageService;
    rateLimitStore?: RateLimitStore;
    now?: () => Date;
  } = {},
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
    createAuthRouter({
      auth: options.auth,
      rateLimitStore: options.rateLimitStore,
      now: options.now,
    }),
  );
  app.use(createModerationRouter({ moderation: options.moderation }));
  app.use(createProfileRouter({ profileService: options.profileService }));
  app.use(createJourneyRouter({ journeyService: options.journeyService }));
  app.use(createTrainRouter({ trainService: options.trainService }));
  app.use(createRequestRouter({ requestService: options.requestService }));
  app.use(
    '/conversations',
    createConversationRouter({
      conversationController: options.conversationService
        ? new ConversationController({ conversationService: options.conversationService })
        : undefined,
      messageController: options.messageService
        ? new MessageController({ messageService: options.messageService })
        : undefined,
    }),
  );

  // Terminal handlers — order matters: 404 first, then the error handler.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
