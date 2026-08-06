import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * The one and only error envelope shape. Every failure response this app
 * sends is `{ error: { code, message, details? } }` — never a bare string or
 * an HTML error page. The request id rides in the `x-request-id` header (set
 * by http-logger), so the envelope stays stable.
 */
export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

/** True for express.json / body-parser failures (bad JSON, too large, ...). */
function isBodyParserError(err: { type?: string }): boolean {
  return (
    err.type === 'entity.parse.failed' ||
    err.type === 'entity.too.large' ||
    err.type === 'encoding.unsupported' ||
    err.type === 'charset.unsupported' ||
    err.type === 'request.aborted'
  );
}

/** body-parser error type → { status, code, message } for the locked envelope. */
const BODY_PARSER_RESPONSES: Record<string, { status: number; code: string; message: string }> = {
  'entity.parse.failed': {
    status: 400,
    code: 'INVALID_JSON',
    message: 'Malformed JSON in request body',
  },
  'entity.too.large': {
    status: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Request body exceeds the allowed size',
  },
  'encoding.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Unsupported request body encoding',
  },
  'charset.unsupported': {
    status: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Unsupported request body charset',
  },
  'request.aborted': {
    status: 400,
    code: 'REQUEST_ABORTED',
    message: 'Request was aborted before the body was fully received',
  },
};

/**
 * Centralized error handler. Runs as the last middleware in the pipeline, so
 * every failure that reaches it — and nothing else — produces a response.
 * Sensitive internals (stack traces) never leave the process except in
 * development.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Headers already sent → we can't change the response; hand off to Express.
  if (res.headersSent) {
    _next(err);
    return;
  }

  const requestId = req.id;

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId }, 'request failed');
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Invalid request data', err.flatten());
    return;
  }

  if (typeof err === 'object' && err !== null && isBodyParserError(err as { type?: string })) {
    const type = (err as { type?: string }).type;
    const entry = type ? BODY_PARSER_RESPONSES[type] : undefined;
    if (entry) {
      sendError(res, entry.status, entry.code, entry.message);
      return;
    }
  }

  // Unknown error — honor a numeric `status` if one was attached, else 500.
  const rawStatus =
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { status?: unknown }).status === 'number'
      ? ((err as { status: number }).status as number)
      : 500;
  // Clamp to the valid HTTP status range so a bogus `status` (<100 or >999)
  // can't make res.status() throw inside this handler and hand the response to
  // Express's default HTML error page (which leaks a stack in non-production).
  const statusCode =
    Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : 500;

  const isServerError = statusCode >= 500;
  const message = isServerError ? 'Internal server error' : 'Request failed';
  const code = isServerError ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_FAILED';
  const details =
    env.NODE_ENV === 'development' && isServerError && err instanceof Error
      ? { stack: err.stack }
      : undefined;

  logger.error({ err, requestId }, 'unhandled request error');
  sendError(res, statusCode, code, message, details);
}
