import type { IncomingMessage, ServerResponse } from 'node:http';
import { pinoHttp } from 'pino-http';
import { logger } from '../utils/logger.js';
import { generateRequestId, sanitizeRequestId } from '../utils/request-id.js';

/**
 * Request logging middleware (pino-http). Mints a request id (honoring a sane
 * inbound `x-request-id` header), echoes it back as a response header so
 * clients and logs share a correlation key, and emits curated, redacted log
 * payloads. Custom log levels: 5xx → error, 4xx → warn, everything else → info.
 */

/** Header allowlist for request logs. */
const LOGGED_REQ_HEADERS = new Set([
  'host',
  'user-agent',
  'accept',
  'content-type',
  'content-length',
  'x-request-id',
]);

/**
 * Curated request serializer. Logs the path without its query string and an
 * allowlisted header subset — never the raw header object, `req.query`, or
 * `req.params`. This is what actually keeps secrets out of request logs:
 * path-based redaction cannot censor a query-string secret
 * (`/oauth/callback?code=...`) or a header name that isn't on the redaction
 * list, so we simply never emit them.
 */
function serializeReq(req: IncomingMessage): Record<string, unknown> {
  const headers: Record<string, unknown> = {};
  for (const name of Object.keys(req.headers)) {
    if (LOGGED_REQ_HEADERS.has(name)) {
      headers[name] = req.headers[name];
    }
  }
  return {
    id: (req as IncomingMessage & { id?: string }).id,
    method: req.method,
    path: req.url?.split('?')[0],
    remoteAddress: req.socket?.remoteAddress,
    headers,
  };
}

/** Response serializer: status code only (response headers, e.g. set-cookie, are never logged). */
function serializeRes(res: ServerResponse): Record<string, unknown> {
  return { statusCode: res.statusCode };
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const inbound = sanitizeRequestId(req.headers['x-request-id']);
    const id = inbound ?? generateRequestId();
    res.setHeader('x-request-id', id);
    // Expose the id to handlers / the error handler via `req.id`.
    (req as IncomingMessage & { id?: string }).id = id;
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // No `redact` here on purpose: passing one to pino-http would *replace* the
  // parent logger's redaction on the child (pino's child() does not merge).
  // Omitting it inherits the full redact list from `logger`, and the curated
  // serializers above never emit raw headers or query strings regardless.
  serializers: {
    req: serializeReq,
    res: serializeRes,
  },
});
