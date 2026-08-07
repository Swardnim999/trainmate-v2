import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from '../config/constants.js';

/**
 * Password hashing (Auth-Design §3, D-A11).
 *
 * bcrypt cost 12. bcryptjs (pure JS, no native build) is used instead of the
 * native `bcrypt` package because it verifies carried-over GoTrue `$2a$` hashes
 * identically — a hard requirement for the Supabase migration.
 *
 * `getDummyPasswordHash` powers login timing equalization: an unknown email
 * still pays one full bcrypt compare against a fixed hash, so response time
 * does not reveal whether the address is registered (§3.1).
 */

let dummyHashCache: string | undefined;

/** A fixed bcrypt hash used as a timing-equalization target for unknown emails. */
export function getDummyPasswordHash(): string {
  dummyHashCache ??= bcrypt.hashSync('trainmate-timing-equalization-dummy', BCRYPT_COST);
  return dummyHashCache;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Hash/verify seam consumed by the service layer (mockable in unit tests). */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
  /** The precomputed dummy hash used for timing equalization on unknown emails. */
  dummyHash(): string;
}

export class BcryptPasswordHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  verify(password: string, hash: string): Promise<boolean> {
    return verifyPassword(password, hash);
  }

  dummyHash(): string {
    return getDummyPasswordHash();
  }
}
