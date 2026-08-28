import { logger } from '../utils/logger.js';
import type { RequestService } from '../services/request.service.js';

/**
 * RequestCleanupJob — Background worker that periodically sweeps and prunes
 * expired pending requests past travel date + 2 days (Spec §13.9, Roadmap Part III §5 Item 6).
 */
export class RequestCleanupJob {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly requestService: RequestService,
    private readonly intervalMs: number = 60 * 60 * 1000, // 1 hour default
  ) {}

  /**
   * Starts the periodic cleanup schedule.
   * Uses unref() so the timer does not hold the Node.js event loop open.
   */
  start(): void {
    if (this.timer) {
      return;
    }
    logger.info(
      `[RequestCleanupJob] Started automated request cleanup schedule (interval: ${this.intervalMs}ms)`,
    );
    this.timer = setInterval(() => {
      this.execute().catch((err) => {
        logger.error({ err }, '[RequestCleanupJob] Unhandled error during scheduled sweep');
      });
    }, this.intervalMs);

    // Allow process to terminate without waiting on this background timer
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the periodic cleanup schedule.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[RequestCleanupJob] Stopped automated request cleanup schedule');
    }
  }

  /**
   * Performs an immediate cleanup sweep.
   * Prunes all pending requests whose travel date is older than (now - 2 days).
   * Guarded against concurrent runs.
   */
  async execute(): Promise<number> {
    if (this.isRunning) {
      logger.warn('[RequestCleanupJob] Previous cleanup sweep still in progress, skipping cycle');
      return 0;
    }

    this.isRunning = true;
    try {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      twoDaysAgo.setHours(0, 0, 0, 0);
      const cutoffStr = twoDaysAgo.toISOString().split('T')[0];

      logger.debug(`[RequestCleanupJob] Executing sweep with cutoff date <= ${cutoffStr}`);
      const prunedCount = await this.requestService.cleanupExpiredRequests(
        'system-cron',
        cutoffStr,
      );

      if (prunedCount > 0) {
        logger.info(
          `[RequestCleanupJob] Successfully pruned ${prunedCount} expired pending request(s)`,
        );
      } else {
        logger.debug('[RequestCleanupJob] Sweep completed: 0 expired pending requests found');
      }

      return prunedCount;
    } catch (error) {
      logger.error(
        { err: error },
        '[RequestCleanupJob] Error during expired request cleanup sweep',
      );
      return 0;
    } finally {
      this.isRunning = false;
    }
  }
}

// CLI standalone runner support
if (process.argv[1]?.includes('request-cleanup.job')) {
  (async () => {
    try {
      const { PrismaClient } = await import('@prisma/client');
      const { RequestRepository } = await import('../repositories/requests.repo.js');
      const { RequestService } = await import('../services/request.service.js');

      const prisma = new PrismaClient();
      const requestsRepo = new RequestRepository(prisma);
      const requestService = new RequestService({ requests: requestsRepo });
      const job = new RequestCleanupJob(requestService);

      console.log('[CLI] Running standalone expired-request cleanup sweep...');
      const count = await job.execute();
      console.log(`[CLI] Finished: ${count} expired requests pruned.`);
      await prisma.$disconnect();
      process.exit(0);
    } catch (err) {
      console.error('[CLI] Failed to run expired-request cleanup:', err);
      process.exit(1);
    }
  })();
}
