/**
 * `Authorization: Bearer <token>` header parsing (Auth-Design §9.1, §18.3).
 *
 * Strict on purpose: a missing header, a non-`Bearer` scheme, a header that Node
 * collapsed from a duplicate (an array), or an empty token all yield `null` so
 * callers treat them as 401 AUTH_REQUIRED — never lenient. Bearer tokens are
 * base64url, so any whitespace around the token is trimmed and the rest is kept.
 * The scheme comparison is case-insensitive per RFC 6750 §2.1.
 */
export function extractBearerToken(authorization: string | string[] | undefined): string | null {
  if (typeof authorization !== 'string') return null;
  const match = /^Bearer[ \t]+(.+)$/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1]!.trim();
  return token.length > 0 ? token : null;
}
