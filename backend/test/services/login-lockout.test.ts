import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLoginLockout } from '../../src/services/login-lockout.js';

// Small tuned policy for fast, deterministic tests: 3 failures inside 10s →
// blocked for 5s.
const MAX_FAILURES = 3;
const WINDOW_MS = 10_000;
const BLOCK_MS = 5_000;

let nowMs: number;
const now = (): Date => new Date(nowMs);

function makeLockout() {
  return new InMemoryLoginLockout({
    now,
    maxFailures: MAX_FAILURES,
    windowMs: WINDOW_MS,
    blockMs: BLOCK_MS,
  });
}

beforeEach(() => {
  nowMs = 1_700_000_000_000;
});

describe('InMemoryLoginLockout', () => {
  it('starts unblocked', () => {
    expect(makeLockout().isBlocked('a@b.c')).toBe(false);
  });

  it('does not block below the failure threshold', () => {
    const lockout = makeLockout();
    expect(lockout.registerFailure('a@b.c')).toBe(false);
    expect(lockout.registerFailure('a@b.c')).toBe(false);
    expect(lockout.isBlocked('a@b.c')).toBe(false);
  });

  it('blocks once the threshold is reached and reports it from registerFailure', () => {
    const lockout = makeLockout();
    expect(lockout.registerFailure('a@b.c')).toBe(false);
    expect(lockout.registerFailure('a@b.c')).toBe(false);
    expect(lockout.registerFailure('a@b.c')).toBe(true);
    expect(lockout.isBlocked('a@b.c')).toBe(true);
  });

  it('keeps the address blocked until the block window elapses', () => {
    const lockout = makeLockout();
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    expect(lockout.isBlocked('a@b.c')).toBe(true);

    nowMs += BLOCK_MS - 1;
    expect(lockout.isBlocked('a@b.c')).toBe(true);

    nowMs += 1;
    expect(lockout.isBlocked('a@b.c')).toBe(false);
  });

  it('treats failures older than the sliding window as expired', () => {
    const lockout = makeLockout();
    lockout.registerFailure('a@b.c'); // t=0
    nowMs += 5_000;
    lockout.registerFailure('a@b.c'); // t=5_000
    nowMs += 5_001; // t=10_001 — first failure (t=0) is now out of the 10s window
    lockout.registerFailure('a@b.c'); // only t=5_000 is still in-window → count 2
    expect(lockout.isBlocked('a@b.c')).toBe(false);

    lockout.registerFailure('a@b.c'); // t=10_001 — all three in [1, 10_001] → block
    expect(lockout.isBlocked('a@b.c')).toBe(true);
  });

  it('resets state after a successful login', () => {
    const lockout = makeLockout();
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    expect(lockout.isBlocked('a@b.c')).toBe(true);

    lockout.reset('a@b.c');
    expect(lockout.isBlocked('a@b.c')).toBe(false);

    // A fresh threshold applies again.
    lockout.registerFailure('a@b.c');
    expect(lockout.isBlocked('a@b.c')).toBe(false);
  });

  it('keeps lockout state isolated per email', () => {
    const lockout = makeLockout();
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    lockout.registerFailure('a@b.c');
    expect(lockout.isBlocked('a@b.c')).toBe(true);
    expect(lockout.isBlocked('other@example.com')).toBe(false);
  });

  it('bounds the number of tracked addresses once the cap is reached', () => {
    const lockout = new InMemoryLoginLockout({
      now,
      maxFailures: MAX_FAILURES,
      windowMs: WINDOW_MS,
      blockMs: BLOCK_MS,
      maxEntries: 2,
    });
    lockout.registerFailure('a@b.c'); // oldest
    lockout.registerFailure('b@b.c');
    lockout.registerFailure('c@b.c'); // at capacity → evicts a@b.c (nothing expired)

    expect(lockout.size).toBe(2);
    expect(lockout.isBlocked('a@b.c')).toBe(false);
    expect(lockout.isBlocked('b@b.c')).toBe(false);
    expect(lockout.isBlocked('c@b.c')).toBe(false);
  });
});
