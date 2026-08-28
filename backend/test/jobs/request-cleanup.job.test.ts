import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestCleanupJob } from '../../src/jobs/request-cleanup.job.js';
import type { RequestService } from '../../src/services/request.service.js';

describe('RequestCleanupJob', () => {
  let mockRequestService: {
    cleanupExpiredRequests: ReturnType<typeof vi.fn>;
  };
  let job: RequestCleanupJob;

  beforeEach(() => {
    vi.useFakeTimers();
    mockRequestService = {
      cleanupExpiredRequests: vi.fn().mockResolvedValue(5),
    };
    job = new RequestCleanupJob(mockRequestService as unknown as RequestService, 3600000);
  });

  afterEach(() => {
    job.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts periodic schedule and executes sweep on tick', async () => {
    job.start();
    expect(mockRequestService.cleanupExpiredRequests).not.toHaveBeenCalled();

    // Advance 1 hour
    await vi.advanceTimersByTimeAsync(3600000);

    expect(mockRequestService.cleanupExpiredRequests).toHaveBeenCalledWith(
      'system-cron',
      expect.any(String),
    );
  });

  it('stops periodic schedule cleanly', async () => {
    job.start();
    job.stop();

    await vi.advanceTimersByTimeAsync(3600000);
    expect(mockRequestService.cleanupExpiredRequests).not.toHaveBeenCalled();
  });

  it('executes immediate sweep and returns pruned count', async () => {
    mockRequestService.cleanupExpiredRequests.mockResolvedValue(12);
    const count = await job.execute();

    expect(count).toBe(12);
    expect(mockRequestService.cleanupExpiredRequests).toHaveBeenCalledWith(
      'system-cron',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
  });

  it('skips concurrent run if previous sweep is still in progress', async () => {
    let resolveFirstRun: (val: number) => void;
    const firstRunPromise = new Promise<number>((resolve) => {
      resolveFirstRun = resolve;
    });

    mockRequestService.cleanupExpiredRequests.mockImplementationOnce(() => firstRunPromise);

    const firstRun = job.execute();
    const secondRun = await job.execute();

    // Second run should skip immediately and return 0
    expect(secondRun).toBe(0);

    resolveFirstRun!(7);
    const firstResult = await firstRun;
    expect(firstResult).toBe(7);
  });

  it('handles service errors gracefully without throwing', async () => {
    mockRequestService.cleanupExpiredRequests.mockRejectedValue(
      new Error('Database connection failed'),
    );

    const result = await job.execute();
    expect(result).toBe(0);
  });
});
