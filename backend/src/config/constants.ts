/** Shared service identity constants. */
export const SERVICE_NAME = 'trainmate-api';
export const APP_VERSION = '0.1.0';

/** Maximum accepted JSON/form body size. */
export const DEFAULT_BODY_LIMIT = '1mb';

/*
 * Authentication constants (Sprint 2B Milestone 3).
 * Values are locked in Auth-Design.md decision records; keep them in sync with
 * that document — D-A13 (access TTL), D-A14 (reset TTL), D-A15 (signup TTL),
 * §16.1 (lockout).
 */

/** Access token lifetime. 15 minutes (D-A13). */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ACCESS_TOKEN_TTL_MS = ACCESS_TOKEN_TTL_SECONDS * 1000;

/** Refresh token lifetime. Sliding 30-day window, re-anchored on every rotation. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Signup email-verification token lifetime. 24 hours (D-A15). */
export const SIGNUP_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Password-reset token lifetime. 60 minutes (D-A14). */
export const RESET_VERIFICATION_TTL_MS = 60 * 60 * 1000;

/** bcrypt cost factor (GoTrue parity — carried-over `$2a$` hashes must verify). */
export const BCRYPT_COST = 12;

/** Password policy (§13.1): 8+ chars, at most 72 UTF-8 bytes (bcrypt input limit). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/** Allowed clock skew when verifying access-token `exp`/`nbf`. */
export const JWT_CLOCK_SKEW_SECONDS = 30;

/* Progressive login lockout (§16.1): 10 failures inside 15 minutes → 15-minute block. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_BLOCK_MS = 15 * 60 * 1000;
