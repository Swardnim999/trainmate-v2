import {
  LOGIN_BLOCK_MS,
  LOGIN_FAILURE_WINDOW_MS,
  LOGIN_MAX_FAILURES,
} from '../config/constants.js';

/**
 * Progressive login lockout (Auth-Design §16.1).
 *
 * Email-keyed, in-process: N failures inside a sliding W window block the
 * address for B. Deliberately single-instance (per Auth-Design §16.2 the
 * multi-instance store is a later Redis phase), so the same class is used as
 * the production store for now and the store seam is where Redis lands later.
 *
 * Lockout is *service-layer* policy (§3.1): the login flow checks `isBlocked`
 * before doing any bcrypt work, and calls `registerFailure` only after a failed
 * verify. `reset` fires on successful login and password reset.
 */

export interface LoginLockoutStore {
  /** True when the address is currently inside a block window. */
  isBlocked(email: string): boolean;
  /**
   * Records a failed attempt for `email`. Returns true if the address is (now)
   * blocked — i.e. the caller should not be surprised by the next gate.
   */
  registerFailure(email: string): boolean;
  /** Clears all state for `email` (successful login / password reset). */
  reset(email: string): void;
}

interface Entry {
  /** Millisecond timestamps of in-window failures, oldest first. */
  failureTimes: number[];
  /** Absolute ms timestamp of block expiry; null when not blocked. */
  blockedUntil: number | null;
}

export interface LoginLockoutOptions {
  now?: () => Date;
  maxFailures?: number;
  windowMs?: number;
  blockMs?: number;
  /** Upper bound on distinct tracked addresses; the stale-est is evicted beyond it. */
  maxEntries?: number;
}

/** Default cap on tracked addresses — bounds memory under a spray attack. */
const DEFAULT_MAX_ENTRIES = 10_000;

export class InMemoryLoginLockout implements LoginLockoutStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => Date;
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly blockMs: number;
  private readonly maxEntries: number;

  constructor(options: LoginLockoutOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxFailures = options.maxFailures ?? LOGIN_MAX_FAILURES;
    this.windowMs = options.windowMs ?? LOGIN_FAILURE_WINDOW_MS;
    this.blockMs = options.blockMs ?? LOGIN_BLOCK_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /** Number of currently tracked addresses (diagnostics / tests). */
  get size(): number {
    return this.entries.size;
  }

  isBlocked(email: string): boolean {
    const entry = this.entries.get(email);
    if (!entry) return false;
    this.prune(email, entry);
    return entry.blockedUntil !== null;
  }

  registerFailure(email: string): boolean {
    const now = this.now().getTime();
    let entry = this.entries.get(email);
    if (!entry) {
      this.evictIfFull();
      entry = { failureTimes: [], blockedUntil: null };
      this.entries.set(email, entry);
    }
    this.prune(email, entry);
    // `prune` may have deleted the entry when everything expired; re-seat it.
    if (!this.entries.has(email)) this.entries.set(email, entry);

    // Defensive guard: while blocked the login gate throws before calling us,
    // so this only protects against an out-of-order caller extending a block.
    if (entry.blockedUntil !== null) return true;

    entry.failureTimes.push(now);
    if (entry.failureTimes.length >= this.maxFailures) {
      entry.blockedUntil = now + this.blockMs;
      entry.failureTimes = [];
    }
    return entry.blockedUntil !== null;
  }

  reset(email: string): void {
    this.entries.delete(email);
  }

  /**
   * Bounds memory under a spray of distinct addresses: once at capacity, drop
   * expired entries first, then the oldest non-expired one. Lockout tracking is
   * best-effort at the cap — the M4 per-IP rate limiter is the real volume guard.
   */
  private evictIfFull(): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [email, entry] of this.entries) {
      this.prune(email, entry);
      if (this.entries.size < this.maxEntries) return;
    }
    // Still at capacity (everything alive): evict the oldest (Map insertion order).
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }

  /** Drops expired failures/blocks. Deletes the entry when nothing remains. */
  private prune(email: string, entry: Entry): void {
    const now = this.now().getTime();
    if (entry.blockedUntil !== null && entry.blockedUntil <= now) {
      entry.blockedUntil = null;
      entry.failureTimes = [];
    }
    entry.failureTimes = entry.failureTimes.filter((t) => now - t <= this.windowMs);
    if (entry.blockedUntil === null && entry.failureTimes.length === 0) {
      this.entries.delete(email);
    }
  }
}
