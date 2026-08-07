import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque-token primitives (Auth-Design §4.2, D-A9/D-A10).
 *
 * Refresh and email-verification tokens are 32 random bytes in canonical
 * base64url, generated from the CSPRNG. Only their SHA-256 hash ever reaches
 * the database — the raw token is the client's proof of possession and is
 * never stored or logged. `isValidOpaqueToken` round-trips through base64url
 * so only canonical encodings of exactly 32 bytes are accepted.
 */
export const OPAQUE_TOKEN_BYTES = 32;

/** Generates a 32-byte CSPRNG token encoded as canonical (unpadded) base64url. */
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

/** SHA-256 hex digest of a token — the value stored in the DB. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** True when `token` is a canonical base64url encoding of exactly 32 bytes. */
export function isValidOpaqueToken(token: unknown): token is string {
  if (typeof token !== 'string' || token.length === 0) return false;
  try {
    const decoded = Buffer.from(token, 'base64url');
    return decoded.length === OPAQUE_TOKEN_BYTES && decoded.toString('base64url') === token;
  } catch {
    return false;
  }
}

/** The default implementation, bound to the pure functions above. */
export interface TokenOps {
  generate(): string;
  hash(token: string): string;
  isValid(token: unknown): token is string;
}

export const tokenOps: TokenOps = {
  generate: generateOpaqueToken,
  hash: hashToken,
  isValid: isValidOpaqueToken,
};
