// Load `.env` first — it must be evaluated before any config module reads
// process.env. Being the first import, it always evaluates first.
import 'dotenv/config';

import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { APP_VERSION, SERVICE_NAME } from './config/constants.js';
import { logger } from './utils/logger.js';
import { initSocketServer } from './sockets/index.js';
import { JwtService } from './utils/jwt.js';
import { ConversationRepository } from './repositories/conversations.repo.js';
import { MessageService } from './services/message.service.js';
import { ConversationService } from './services/conversation.service.js';

const jwtService = new JwtService(env.JWT_SECRET);
const conversationsRepo = new ConversationRepository();

const server = createServer();

const { io, broadcaster } = initSocketServer({
  httpServer: server,
  jwtService,
  conversationsRepo,
  corsOrigin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
});

const conversationService = new ConversationService({ broadcaster });
const messageService = new MessageService({ broadcaster });

const app = createApp({
  conversationService,
  messageService,
});

server.on('request', app);

const SHUTDOWN_TIMEOUT_MS = 10_000;

let shuttingDown = false;

/** Close the HTTP and Socket.IO server, then exit. Force-exits after the timeout. */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'shutdown initiated');

  const forceExit = setTimeout(() => {
    logger.warn(`shutdown timeout exceeded (${SHUTDOWN_TIMEOUT_MS}ms) — force closing`);
    // An operator-initiated drain that overruns its budget is a best-effort
    // stop, not a crash: exit 0 so orchestrators (k8s, Docker restart policy)
    // don't record a routine deploy as a failure.
    io.close();
    server.closeAllConnections();
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  io.close(() => {
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'error while closing server');
        process.exit(1);
      }
      logger.info('server closed cleanly');
      process.exit(0);
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Crash-fast for programmer errors: log, then exit so the supervisor restarts.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection — exiting');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception — exiting');
  process.exit(1);
});

server.on('error', (err: Error) => {
  logger.fatal({ err }, 'http server error — exiting');
  process.exit(1);
});

server.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT, version: APP_VERSION },
    `${SERVICE_NAME} listening`,
  );
});
