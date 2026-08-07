import { z } from 'zod';
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from '../config/constants.js';
import { hasControlChar, isValidEmail } from '../utils/validate.js';

/**
 * Route-boundary Zod schemas for the auth endpoints (Auth-Design §12/§13).
 *
 * These mirror the service layer's invariants (src/utils/validate.ts) so the
 * boundary rejects bad input first with rich ZodError detail, while the service
 * re-checks what it relies on as defense in depth. Two deliberate asymmetries:
 *  - `emailSchema` normalizes (trim + lowercase) so the parsed value and the
 *    per-email rate-limit key always see the canonical address.
 *  - `loginPasswordSchema` accepts any *non-empty* password: the 8-72 policy
 *    (§13.2) applies at set time; a short password at login is a failed
 *    credential (uniform 401), not a validation error.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => isValidEmail(value), { message: 'Invalid email address' });

const passwordSetSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  // Loose code-unit pre-filter only (each UTF-8 char is ≥1 byte, so a ≤72-byte
  // password is always ≤72 code units — this never wrongly rejects); the real
  // bcrypt limit is enforced below in bytes.
  .max(PASSWORD_MAX_BYTES)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= PASSWORD_MAX_BYTES, {
    message: 'Password must not exceed 72 UTF-8 bytes',
  })
  .refine((value) => !hasControlChar(value), {
    message: 'Password must not contain control characters',
  });

/** Redirect target is deliberately lenient — §6.4: a malformed/unknown value
 * silently falls back to the default origin, never a 400. Length is bounded so
 * an attacker cannot send a multi-megabyte `redirect_to`. */
const redirectToSchema = z.string().max(2048);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSetSchema,
  emailRedirectTo: redirectToSchema.optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(4096),
});

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

/** Logout is idempotent (§8.4) — an empty/absent refresh token is a no-op 204,
 * so the schema stays lenient rather than rejecting it. */
export const logoutSchema = z.object({
  refresh_token: z.string().optional(),
});

export const confirmEmailSchema = z.object({
  token: z.string().min(1),
});

export const verifyEmailQuerySchema = z.object({
  token: z.string().min(1),
  redirect_to: redirectToSchema.optional(),
});

export const resendVerificationSchema = z.object({
  email: emailSchema,
});

export const requestPasswordResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSetSchema,
});
