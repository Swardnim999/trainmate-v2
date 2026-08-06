import { randomUUID } from 'node:crypto';

const MAX_HEADER_LENGTH = 100;
const HEADER_RE = /^[A-Za-z0-9._-]+$/;

/** Generate a fresh request id. */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Accept an inbound `x-request-id` header only if it looks sane, so callers
 * can trace a request end-to-end. Anything weird (missing, too long, wrong
 * characters) yields `undefined` and a fresh UUID is minted instead — a
 * hostile header must never become a log-injection vector.
 */
export function sanitizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HEADER_LENGTH) return undefined;
  if (!HEADER_RE.test(trimmed)) return undefined;
  return trimmed;
}
