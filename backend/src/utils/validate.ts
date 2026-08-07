import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '../config/constants.js';
import { AppError } from './errors.js';

/**
 * Field-level validation invariants (Auth-Design §13).
 *
 * This is the defense-in-depth floor, applied by the service layer regardless of
 * transport. Request-boundary Zod schemas (the Sprint 2B M4 routes) enforce the
 * same rules earlier with richer error detail; the service must never assume the
 * boundary ran, so it re-checks what it relies on.
 */

// RFC-approximate shape. Auth-Design §13.2 requires trim + lowercase + max 254;
// the precise mailbox syntax is the frontend's concern. Everything here must be
// deterministic so validate and normalize can never disagree.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  // Boundary defense: the service must not assume the route ran, and a non-string
  // (undefined/null) would otherwise crash `.trim()` with a raw TypeError (500).
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return (
    normalized.length > 0 &&
    normalized.length <= 254 &&
    !hasControlChar(normalized) &&
    EMAIL_RE.test(normalized)
  );
}

/** Throws 400 VALIDATION_ERROR unless `email` is a structurally valid address. */
export function assertEmailValid(email: string): void {
  if (!isValidEmail(email)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A valid email address is required');
  }
}

/**
 * Throws 400 VALIDATION_ERROR unless `password` satisfies the policy:
 * 8+ chars, ≤72 UTF-8 bytes (bcrypt input limit — must reject before bcrypt
 * silently truncates), and no ASCII control characters (incl. NUL, which
 * Postgres text columns reject).
 */
export function assertPasswordValid(password: string): void {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `Password must not exceed ${PASSWORD_MAX_BYTES} bytes`,
    );
  }
  if (hasControlChar(password)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Password must not contain control characters');
  }
}

/** True when any code point is an ASCII control char (0x00-0x1f or DEL 0x7f). */
export function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0);
    if (code !== undefined && (code < 32 || code === 127)) return true;
  }
  return false;
}
