import { pino } from 'pino';
import { env } from '../config/env.js';
import { SERVICE_NAME } from '../config/constants.js';

/**
 * Application logger (pino). Structured JSON at every level; human-readable
 * pretty output only in development. Secrets are redacted at the source so no
 * log line can carry a credential by accident.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: SERVICE_NAME, env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-auth-token"]',
      '*.password',
      '*.passwordConfirmation',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.secret',
      '*.apiKey',
      '*.email',
    ],
    censor: '[REDACTED]',
  },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});
