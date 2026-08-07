import type { NextFunction, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

/**
 * Per-route request rate limiting (Auth-Design §16).
 *
 * Each auth route mounts one or two `createRateLimiter` middleware (per-IP and,
 * where §16.1 specifies, per-email) positioned *before* the controller so abusive
 * traffic is shed before any bcrypt work. A limiter counts requests inside a
 * sliding window and, past the limit, answers 429 RATE_LIMITED with a
 * Retry-After header (seconds until the oldest in-window request ages out).
 *
 * The store is an injected `RateLimitStore` so tests can pass a fresh store and
 * production can later swap the same interface for a Redis-backed one (§16.2).
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the caller should wait before retrying; 0 while allowed. */
  retryAfterSeconds: number;
}

/** Sliding-window counter keyed by a namespace string (e.g. `login:ip:1.2.3.4`). */
export interface RateLimitStore {
  consume(key: string, windowMs: number, now: number, limit: number): RateLimitResult;
  reset(key: string): void;
}

export interface InMemoryRateLimitStoreOptions {
  /** Bounded memory under a key spray: beyond this many tracked keys the
   * stale-est bucket is evicted (mirrors InMemoryLoginLockout's cap). */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 100_000;

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, number[]>();
  private readonly maxKeys: number;
  /** Head index per bucket to avoid O(n^2) Array.shift() drain. */
  private readonly heads = new Map<string, number>();

  constructor(options: InMemoryRateLimitStoreOptions = {}) {
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  consume(key: string, windowMs: number, now: number, limit: number): RateLimitResult {
    let times = this.buckets.get(key);
    let head = this.heads.get(key) ?? 0;

    if (!times) {
      this.evictIfFull(now, windowMs);
      times = [];
      this.buckets.set(key, times);
      this.heads.set(key, 0);
      head = 0;
    }

    const cutoff = now - windowMs;

    // Advance head index past expired entries (O(1) per expired entry, no reindex)
    while (head < times.length && times[head]! <= cutoff) {
      head++;
    }

    // If already at or over limit (in-window count >= limit), DO NOT push a new timestamp
    // (bounds per-key array to <= limit entries; head tracks the window start).
    const inWindow = times.length - head;
    if (inWindow >= limit) {
      const oldest = times[head]!;
      this.heads.set(key, head);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest - cutoff) / 1000)),
      };
    }

    // Allowed: push timestamp
    times.push(now);
    this.heads.set(key, head);

    // Compact if head has advanced far (ratio-based to amortize)
    if (head > 100 && head > times.length * 0.25) {
      this.buckets.set(key, times.slice(head));
      this.heads.set(key, 0);
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.buckets.delete(key);
    this.heads.delete(key);
  }

  /**
   * Bounds memory at the key cap: drop a fully-expired bucket first (every
   * request has aged out of its window), else evict the bucket whose *most
   * recent* request is oldest — the documented "stale-est" bucket — rather than
   * merely the oldest-inserted, so an actively-used key is never the guaranteed
   * victim. Eviction only frees one slot; limiting stays best-effort at the cap
   * (§16.2, and the service login lockout remains the account-level guard).
   */
  private evictIfFull(now: number, windowMs: number): void {
    if (this.buckets.size < this.maxKeys) return;
    const cutoff = now - windowMs;

    // First pass: try to find and drop a fully-expired bucket (head reaches end)
    for (const [bucketKey, times] of this.buckets) {
      let head = this.heads.get(bucketKey) ?? 0;
      while (head < times.length && times[head]! <= cutoff) {
        head++;
      }
      if (head >= times.length) {
        this.buckets.delete(bucketKey);
        this.heads.delete(bucketKey);
        return;
      }
    }

    // Second pass: stale-est (oldest most-recent request) — scan only once with cached head
    let staleKey: string | undefined;
    let oldestLast = Infinity;
    for (const [bucketKey, times] of this.buckets) {
      // last in-window is times[times.length - 1]
      const last = times[times.length - 1]!;
      if (last < oldestLast) {
        oldestLast = last;
        staleKey = bucketKey;
      }
    }
    if (staleKey !== undefined) {
      this.buckets.delete(staleKey);
      this.heads.delete(staleKey);
    }
  }
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  keyGenerator: (req: Request) => string;
  store?: RateLimitStore;
  now?: () => Date;
  /** Override the default 429 JSON (browser-facing routes redirect instead, §6.2). */
  onBlocked?: (req: Request, res: Response) => void;
  /** Explicit namespace for structured logging (e.g. 'login:ip', 'register:email').
   * Avoids deriving from the key string (which leaks IPv6 address fragments). */
  namespace?: string;
}

export function createRateLimiter(options: RateLimitOptions) {
  const store = options.store ?? new InMemoryRateLimitStore();
  const now = options.now ?? (() => new Date());
  // Track last warning timestamp per key to coalesce flood logs (one warn per key per window).
  const lastWarnedAt = new Map<string, number>();

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const key = options.keyGenerator(req);
    const { allowed, retryAfterSeconds } = store.consume(
      key,
      options.windowMs,
      now().getTime(),
      options.limit,
    );
    if (allowed) {
      next();
      return;
    }

    const keyNamespace = options.namespace ?? key.slice(0, key.lastIndexOf(':'));
    const keyDigest = createHash('sha256').update(key).digest('hex').slice(0, 16);

    // Coalesce: only warn on the first block for this key in this window
    const nowMs = now().getTime();
    const windowStart = nowMs - options.windowMs;
    if (lastWarnedAt.get(key) !== windowStart) {
      lastWarnedAt.set(key, windowStart);
      logger.warn(
        {
          requestId: req.id,
          keyNamespace,
          keyDigest,
          limit: options.limit,
          windowMs: options.windowMs,
        },
        'auth route rate limit exceeded',
      );
    }

    if (options.onBlocked) {
      options.onBlocked(req, res);
      return;
    }
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  };
}
