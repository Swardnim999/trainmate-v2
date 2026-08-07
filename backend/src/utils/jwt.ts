import { errors, jwtVerify, SignJWT } from 'jose';
import { JWT_CLOCK_SKEW_SECONDS } from '../config/constants.js';
import { AppError } from './errors.js';

/**
 * Stateless access tokens (Auth-Design §4.1, D-A13).
 *
 * HS256 signed with the shared JWT_SECRET. The algorithm is pinned via jose's
 * `algorithms` option — an `alg: "none"` or RS256 header is rejected at the
 * JOSE layer before any claim is trusted. On top of the signature, the token
 * must carry `type: "access"` and a UUID `sub`; anything else is treated as a
 * foreign or malformed token and rejected. Verify maps failures to the locked
 * AUTH_TOKEN_EXPIRED / AUTH_INVALID_TOKEN codes (§1.3).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface JwtUser {
  id: string;
  email: string;
}

export interface VerifiedAccessToken {
  /** User id (JWT `sub` claim). */
  sub: string;
  email: string;
  /** Expiry epoch seconds — lets callers answer "does the client need to refresh?". */
  exp: number;
}

/** Sign/verify seam consumed by the service layer (mockable in unit tests). */
export interface JwtSigner {
  sign(user: JwtUser, now: Date, ttlSeconds: number): Promise<string>;
  verify(token: string): Promise<VerifiedAccessToken>;
}

export class JwtService implements JwtSigner {
  private readonly key: Uint8Array;
  private readonly clockSkewSeconds: number;

  constructor(secret: string, clockSkewSeconds: number = JWT_CLOCK_SKEW_SECONDS) {
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
    this.key = new TextEncoder().encode(secret);
    this.clockSkewSeconds = clockSkewSeconds;
  }

  async sign(user: JwtUser, now: Date, ttlSeconds: number): Promise<string> {
    const nowSeconds = Math.floor(now.getTime() / 1000);
    return new SignJWT({ email: user.email, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ttlSeconds)
      .sign(this.key);
  }

  async verify(token: string): Promise<VerifiedAccessToken> {
    let payload: {
      sub?: unknown;
      email?: unknown;
      type?: unknown;
      exp?: unknown;
    };
    try {
      const result = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        clockTolerance: this.clockSkewSeconds,
      });
      payload = result.payload;
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new AppError(401, 'AUTH_TOKEN_EXPIRED', 'Access token expired');
      }
      // Covers JWTInvalid / JWSSignatureVerificationFailed / JWKParseFailed / etc.
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid access token');
    }

    // Beyond a valid signature: the token must be an access token for a UUID
    // subject with a string email — reject foreign (e.g. reset) tokens.
    if (
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      !UUID_RE.test(payload.sub) ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number'
    ) {
      throw new AppError(401, 'AUTH_INVALID_TOKEN', 'Invalid access token');
    }

    return { sub: payload.sub, email: payload.email, exp: payload.exp };
  }
}
